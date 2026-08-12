import { GraphQLError } from 'graphql';
import { prisma } from './db.js';
import { enqueueEvaluation } from './queue.js';
import { getStudents, findById } from './students.js';

interface GraphQLContext {
  studentId: string;
}

type Semaforo = 'verde' | 'amarillo' | 'rojo';

function computeSemaforo(purchaseByDate: Date | null, comprada: boolean): Semaforo | null {
  if (comprada || !purchaseByDate) return null;
  const daysUntil = Math.ceil((purchaseByDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysUntil <= 3) return 'rojo';
  if (daysUntil <= 10) return 'amarillo';
  return 'verde';
}

function toMaterialItem(m: {
  id: string;
  item: string;
  critical: boolean;
  week: number | null;
  purchaseByDate: Date | null;
  notas: string | null;
  comprada: boolean;
}) {
  return {
    id: m.id,
    item: m.item,
    critical: m.critical,
    week: m.week,
    purchaseByDate: m.purchaseByDate ? m.purchaseByDate.toISOString().split('T')[0] : null,
    semaforo: computeSemaforo(m.purchaseByDate, m.comprada),
    notas: m.notas,
    comprada: m.comprada,
  };
}

export const resolvers = {
  Query: {
    async today(_parent: unknown, _args: unknown, context: GraphQLContext) {
      const lessons = await prisma.lesson.findMany({
        orderBy: [{ week: 'asc' }, { dayIndex: 'asc' }],
      });

      if (lessons.length === 0) {
        throw new GraphQLError('No hay lecciones cargadas todavía');
      }

      // Simplificación temporal: la "lección de hoy" es la primera en la secuencia
      // (ordenada por week, dayIndex) que aún no tiene un Submission evaluated DE
      // ESTE estudiante — cada hermano avanza por su cuenta sobre el mismo
      // currículo compartido. Si todas están completas, se devuelve la última. El
      // agendamiento real por fecha de calendario (content/curriculum.yaml
      // meta.start_date) se resuelve en una rebanada futura.
      let currentLesson = lessons[lessons.length - 1];
      for (const lesson of lessons) {
        const evaluatedCount = await prisma.submission.count({
          where: { lessonId: lesson.id, status: 'evaluated', studentId: context.studentId },
        });
        if (evaluatedCount === 0) {
          currentLesson = lesson;
          break;
        }
      }

      const recentSubmissions = await prisma.submission.findMany({
        where: { studentId: context.studentId },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });

      return {
        lesson: currentLesson,
        recentSubmissions: recentSubmissions.map((s) => ({
          id: s.id,
          status: s.status,
          objectKey: s.objectKey,
          sessionNumber: s.sessionNumber,
          createdAt: s.createdAt.toISOString(),
        })),
      };
    },
    async submission(_parent: unknown, args: { id: string }, context: GraphQLContext) {
      const submission = await prisma.submission.findUnique({ where: { id: args.id } });
      if (!submission || submission.studentId !== context.studentId) return null;
      return submission;
    },
    async parentPanel() {
      const evaluationsConBandera = await prisma.evaluation.findMany({
        where: { banderaParaPapa: { not: null } },
        include: { submission: { include: { lesson: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const banderas = evaluationsConBandera.map((e) => ({
        submissionId: e.submissionId,
        studentId: e.submission.studentId,
        studentName: findById(e.submission.studentId)?.name ?? e.submission.studentId,
        sessionNumber: e.submission.sessionNumber,
        lessonTema: e.submission.lesson.tema,
        texto: e.banderaParaPapa as string,
        createdAt: e.createdAt.toISOString(),
      }));

      const materialItems = await prisma.materialItem.findMany({
        orderBy: [{ week: 'asc' }, { critical: 'desc' }, { purchaseByDate: 'asc' }],
      });

      const estudiantes = getStudents().map((s) => ({ id: s.id, name: s.name }));
      const paquetes = await Promise.all(
        estudiantes.map(async (s) => ({
          studentId: s.id,
          studentName: s.name,
          disponible: (await prisma.submission.count({ where: { status: 'evaluated', studentId: s.id } })) > 0,
        })),
      );

      return {
        banderas,
        materiales: materialItems.map(toMaterialItem),
        estudiantes,
        paquetes,
      };
    },
  },
  Mutation: {
    async marcarMaterial(_parent: unknown, args: { id: string; comprada: boolean }) {
      try {
        const material = await prisma.materialItem.update({
          where: { id: args.id },
          data: { comprada: args.comprada },
        });
        return toMaterialItem(material);
      } catch {
        throw new GraphQLError('Material no encontrado');
      }
    },
    async submitForEvaluation(
      _parent: unknown,
      args: { submissionId: string; ratings: Array<{ criterio: string; nivel: number }> },
      context: GraphQLContext,
    ) {
      const submission = await prisma.submission.findUnique({ where: { id: args.submissionId } });
      if (!submission || submission.studentId !== context.studentId) {
        throw new GraphQLError('Submission no encontrado');
      }
      if (submission.status !== 'uploaded') {
        throw new GraphQLError(
          `Submission ya está en estado '${submission.status}', no se puede reenviar`,
        );
      }

      // Invariante de producto: máximo N evaluaciones por día por estudiante
      // (N = MAX_EVALS_PER_DAY, default 3) — cada hermano tiene su propio cupo,
      // no se comparte. Cuenta envíos de HOY que ya entraron a la cola o más
      // adelante (no cuenta los que solo están en 'uploaded' sin autoevaluación
      // todavía).
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const maxPerDay = parseInt(process.env.MAX_EVALS_PER_DAY ?? '3', 10);
      const countToday = await prisma.submission.count({
        where: {
          studentId: context.studentId,
          createdAt: { gte: startOfDay },
          status: { in: ['queued', 'evaluating', 'evaluated'] },
        },
      });
      if (countToday >= maxPerDay) {
        throw new GraphQLError(`Ya se alcanzó el máximo de ${maxPerDay} evaluaciones por día`);
      }

      const ratingsMap = Object.fromEntries(args.ratings.map((r) => [r.criterio, r.nivel]));

      await prisma.selfAssessment.upsert({
        where: { submissionId: args.submissionId },
        create: { submissionId: args.submissionId, ratings: ratingsMap },
        update: { ratings: ratingsMap },
      });

      // enqueueEvaluation transiciona uploaded -> queued y agrega el job a BullMQ.
      // NO espera a que el worker termine — la mutación regresa de inmediato.
      await enqueueEvaluation(args.submissionId);

      return prisma.submission.findUniqueOrThrow({ where: { id: args.submissionId } });
    },
  },
  Submission: {
    async evaluation(parent: { id: string }) {
      const evaluation = await prisma.evaluation.findUnique({ where: { submissionId: parent.id } });
      if (!evaluation) return null;
      const rubric = evaluation.rubricJson as {
        criterios_foco: Array<{ criterio: string; nivel: number; evidencia: string }>;
        lo_que_funciona: string;
        lo_que_sigue: string;
        micro_ejercicio: { instruccion: string; minutos: number };
        huella_estilo: string[];
        calidad_foto: { usable: boolean; problemas: string[] };
      };
      return {
        criteriosFoco: rubric.criterios_foco,
        loQueFunciona: rubric.lo_que_funciona,
        loQueSigue: rubric.lo_que_sigue,
        microEjercicio: rubric.micro_ejercicio,
        huellaEstilo: rubric.huella_estilo,
        banderaParaPapa: evaluation.banderaParaPapa,
        calidadFoto: rubric.calidad_foto,
        promptSha256: evaluation.promptSha256,
        model: evaluation.model,
        createdAt: evaluation.createdAt.toISOString(),
      };
    },
  },
};
