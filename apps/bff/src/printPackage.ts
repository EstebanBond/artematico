import { Router, type Router as ExpressRouter } from 'express';
import PDFDocument from 'pdfkit';
import { prisma } from './db.js';
import { findById } from './students.js';

type PDFDoc = InstanceType<typeof PDFDocument>;

interface RubricJson {
  criterios_foco: Array<{ criterio: string; nivel: number; evidencia: string }>;
  lo_que_funciona: string;
  lo_que_sigue: string;
  micro_ejercicio: { instruccion: string; minutos: number };
}

export const printPackageRouter: ExpressRouter = Router();

printPackageRouter.get('/print-package', async (req, res) => {
  // Handler async directo de Express 4: sin este try/catch, una promesa
  // rechazada (ej. la consulta a Prisma falla) no la captura nadie — la
  // request se queda colgada en vez de recibir una respuesta (mismo patrón
  // de bug ya corregido antes en upload.ts y worker.ts).
  let doc: PDFDoc | undefined;
  try {
    const studentId = req.query.studentId;
    const student = typeof studentId === 'string' ? findById(studentId) : undefined;
    if (!student) {
      res.status(400).json({ error: 'Falta o es inválido el parámetro studentId' });
      return;
    }

    const submissions = await prisma.submission.findMany({
      where: { status: 'evaluated', studentId: student.id },
      include: { lesson: true, selfAssessment: true, evaluation: true, styleTraits: true },
      orderBy: { sessionNumber: 'asc' },
    });

    if (submissions.length === 0) {
      res.status(404).json({ error: 'Todavía no hay sesiones evaluadas para generar el paquete' });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="taller-paquete-${student.id}.pdf"`);

    doc = new PDFDocument({ size: 'letter', margin: 54 });
    doc.pipe(res);

    // Portada
    doc.fontSize(26).text('Taller de Ilustración', { align: 'center' });
    doc.fontSize(18).text(student.name, { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).fillColor('#555555').text(`${submissions.length} sesiones completadas`, { align: 'center' });
    doc.fillColor('black');

    // Una hoja de acompañamiento por sesión evaluada. Cada una se aísla en su
    // propio try/catch: una fila con datos corruptos/incompletos no debe
    // tumbar las demás páginas ya generadas (encontrado en verificación real:
    // una evaluación de prueba con rubricJson: '{}' rompía TODO el PDF).
    for (const submission of submissions) {
      doc.addPage();
      try {
        renderSessionSheet(doc, submission);
      } catch (pageErr) {
        console.error(`Error renderizando la hoja de la sesión ${submission.sessionNumber}:`, pageErr);
        doc.fontSize(11).fillColor('#b91c1c').text('No se pudo generar esta hoja (datos incompletos).');
        doc.fillColor('black');
      }
    }

    // Capítulo final "Tu huella"
    doc.addPage();
    renderHuellaChapter(doc, submissions);

    doc.end();
  } catch (err) {
    console.error('Error generando el paquete de impresión:', err);
    if (res.headersSent) {
      // Ya empezamos a transmitir el PDF (headers + algunas páginas) — no se
      // puede cambiar a un 500 a estas alturas. Cerrar `doc` (no `res`
      // directamente): res está encadenado a doc vía pipe(), y terminar res
      // por su cuenta mientras doc sigue vivo produce "write after end"
      // cuando doc intenta escribir datos ya en vuelo.
      doc?.end();
    } else {
      res.status(500).json({ error: 'No se pudo generar el paquete de impresión' });
    }
  }
});

function renderSessionSheet(
  doc: PDFDoc,
  submission: {
    sessionNumber: number;
    lesson: { technique: string; tema: string; papel: string };
    selfAssessment: { ratings: unknown } | null;
    evaluation: { rubricJson: unknown } | null;
  },
): void {
  doc.fontSize(18).text(`Sesión ${submission.sessionNumber}`, { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Técnica: ${submission.lesson.technique}`);
  doc.text(`Tema: ${submission.lesson.tema}`);
  doc.text(`Papel: ${submission.lesson.papel}`);
  doc.moveDown();

  if (!submission.evaluation) {
    doc.fontSize(11).fillColor('#888888').text('(Sin evaluación registrada para esta sesión.)');
    doc.fillColor('black');
    return;
  }

  const rubric = submission.evaluation.rubricJson as RubricJson;
  if (!Array.isArray(rubric.criterios_foco)) {
    doc.fontSize(11).fillColor('#888888').text('(Datos de evaluación incompletos para esta sesión.)');
    doc.fillColor('black');
    return;
  }
  const ratings = (submission.selfAssessment?.ratings as Record<string, number> | undefined) ?? {};

  doc.fontSize(14).text('Autoevaluación vs. evaluación', { underline: true });
  doc.moveDown(0.3);
  for (const c of rubric.criterios_foco) {
    const self = ratings[c.criterio] ?? '—';
    doc.fontSize(11).text(`${c.criterio}: tú dijiste ${self}, el mentor vio ${c.nivel} — ${c.evidencia}`);
    doc.moveDown(0.2);
  }

  doc.moveDown();
  doc.fontSize(14).text('Lo que funciona', { underline: true });
  doc.fontSize(11).text(rubric.lo_que_funciona);
  doc.moveDown();
  doc.fontSize(14).text('Lo que sigue', { underline: true });
  doc.fontSize(11).text(rubric.lo_que_sigue);
  doc.moveDown();
  doc.fontSize(14).text('Micro-ejercicio', { underline: true });
  doc.fontSize(11).text(`${rubric.micro_ejercicio.instruccion} (${rubric.micro_ejercicio.minutos} min)`);
}

function renderHuellaChapter(
  doc: PDFDoc,
  submissions: Array<{ styleTraits: Array<{ text: string }> }>,
): void {
  doc.fontSize(22).text('Tu huella', { align: 'center' });
  doc.moveDown();
  doc
    .fontSize(12)
    .text(
      'Estos son los rasgos que se repitieron a lo largo del taller — tu forma de dibujar, no una calificación.',
    );
  doc.moveDown();

  const counts = new Map<string, number>();
  for (const s of submissions) {
    for (const trait of s.styleTraits) {
      counts.set(trait.text, (counts.get(trait.text) ?? 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) {
    doc.fontSize(12).text('Todavía no se registraron rasgos de estilo.');
    return;
  }
  for (const [text, count] of sorted) {
    doc.fontSize(12).text(`• ${text}${count > 1 ? ` (se repitió ${count} veces)` : ''}`);
    doc.moveDown(0.3);
  }
}
