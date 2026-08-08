import { GraphQLError } from 'graphql';
import { prisma } from './db.js';
import { enqueueEvaluation } from './queue.js';
import { getComprasPendientes } from './curriculum.js';

export const resolvers = {
  Query: {
    async today() {
      const lessons = await prisma.lesson.findMany({
        orderBy: [{ week: 'asc' }, { dayIndex: 'asc' }],
      });

      if (lessons.length === 0) {
        throw new GraphQLError('No hay lecciones cargadas todavía');
      }

      // Simplificación temporal: la "lección de hoy" es la primera en la secuencia
      // (ordenada por week, dayIndex) que aún no tiene un Submission evaluated.
      // Si todas están completas, se devuelve la última. El agendamiento real por
      // fecha de calendario (content/curriculum.yaml meta.start_date) se resuelve
      // en una rebanada futura cuando se integre el contenido real del curso.
      let currentLesson = lessons[lessons.length - 1];
      for (const lesson of lessons) {
        const evaluatedCount = await prisma.submission.count({
          where: { lessonId: lesson.id, status: 'evaluated' },
        });
        if (evaluatedCount === 0) {
          currentLesson = lesson;
          break;
        }
      }

      const recentSubmissions = await prisma.submission.findMany({
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
    async submission(_parent: unknown, args: { id: string }) {
      return prisma.submission.findUnique({ where: { id: args.id } });
    },
    async parentPanel() {
      const evaluationsConBandera = await prisma.evaluation.findMany({
        where: { banderaParaPapa: { not: null } },
        include: { submission: { include: { lesson: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const banderas = evaluationsConBandera.map((e) => ({
        submissionId: e.submissionId,
        sessionNumber: e.submission.sessionNumber,
        lessonTema: e.submission.lesson.tema,
        texto: e.banderaParaPapa as string,
        createdAt: e.createdAt.toISOString(),
      }));

      const comprasPendientes = getComprasPendientes();

      return { banderas, comprasPendientes };
    },
  },
  Mutation: {
    async submitForEvaluation(
      _parent: unknown,
      args: { submissionId: string; ratings: Array<{ criterio: string; nivel: number }> },
    ) {
      const submission = await prisma.submission.findUnique({ where: { id: args.submissionId } });
      if (!submission) {
        throw new GraphQLError('Submission no encontrado');
      }
      if (submission.status !== 'uploaded') {
        throw new GraphQLError(
          `Submission ya está en estado '${submission.status}', no se puede reenviar`,
        );
      }

      // Invariante de producto: máximo N evaluaciones por día (N = MAX_EVALS_PER_DAY,
      // default 3). Cuenta envíos de HOY que ya entraron a la cola o más adelante
      // (no cuenta los que solo están en 'uploaded' sin autoevaluación todavía).
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const maxPerDay = parseInt(process.env.MAX_EVALS_PER_DAY ?? '3', 10);
      const countToday = await prisma.submission.count({
        where: {
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
