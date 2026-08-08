import { Worker, type Job, type WorkerOptions } from 'bullmq';
import { createRedisConnection } from './redis.js';
import { prisma } from './db.js';
import { transitionStatus } from './stateMachine.js';
import type { EvaluationJobData } from './queue.js';
import fs from 'node:fs/promises';
import path from 'node:path';

interface RubricResponse {
  tecnica: string;
  criterios_foco: Array<{ criterio: string; nivel: number; evidencia: string }>;
  lo_que_funciona: string;
  lo_que_sigue: string;
  micro_ejercicio: { instruccion: string; minutos: number };
  huella_estilo?: string[];
  bandera_para_papa?: string | null;
  calidad_foto?: { usable: boolean; problemas: unknown[] };
}

export async function processEvaluationJob(job: Job<EvaluationJobData>): Promise<void> {
  const { submissionId } = job.data;

  // Acepta 'queued' (primer intento) Y 'evaluating' (reintento de un job que
  // quedó "stalled": un worker murió a medio proceso sin terminar). Si el guard
  // solo aceptara 'queued', un job reencolado tras un crash llegaría con status
  // 'evaluating' (dejado así por el intento anterior), el guard fallaría, la
  // función retornaría sin hacer nada, y BullMQ marcaría el job como completado
  // — el Submission quedaría atascado en 'evaluating' para siempre.
  const transitioned = await transitionStatus(submissionId, ['queued', 'evaluating'], 'evaluating');
  if (!transitioned) {
    // El status ya es 'evaluated' o 'failed' — otro intento ya lo resolvió.
    // No reprocesar.
    return;
  }

  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { lesson: true, selfAssessment: true },
  });

  try {
    const uploadDir = process.env.UPLOAD_DIR ?? '/uploads';
    const imageBytes = await fs.readFile(path.join(uploadDir, submission.objectKey));

    const context = {
      tecnica: submission.lesson.technique,
      papel: submission.lesson.papel,
      criterios_foco: submission.lesson.criteriosFoco,
      criterios_desactivados: submission.lesson.fallbackDisableCriteria,
      consigna: submission.lesson.consigna,
      autoevaluacion: (submission.selfAssessment?.ratings as Record<string, number>) ?? {},
      n: submission.sessionNumber,
      huella_previa: [] as string[],
    };

    const form = new FormData();
    // El evaluator (rebanada 03) exige un content-type de la whitelist jpeg/png/webp
    // en la parte multipart, o rechaza con 400 antes de siquiera abrir la imagen.
    // Sin `type` aquí, el Blob queda sin content-type y la validación falla.
    // Simplificación: se asume JPEG (igual que upload.ts, que ya guarda todo con
    // extensión .jpg sin importar el formato real subido) — Pillow del lado del
    // evaluator detecta el formato real por los bytes, no por este header, así
    // que esto es seguro aunque el archivo original fuera PNG/WebP. El tipo MIME
    // original no se persiste hoy en Submission; una rebanada futura podría
    // guardarlo si hace falta preservarlo con exactitud.
    form.append('image', new Blob([imageBytes], { type: 'image/jpeg' }), 'image.jpg');
    form.append('context', JSON.stringify(context));

    const evaluatorUrl = process.env.EVALUATOR_URL ?? 'http://localhost:8000';
    const response = await fetch(`${evaluatorUrl}/evaluate`, { method: 'POST', body: form });

    if (!response.ok) {
      throw new Error(`Evaluator respondió ${response.status}: ${await response.text()}`);
    }

    const rubric = (await response.json()) as RubricResponse;
    const promptSha256 = response.headers.get('x-prompt-sha256') ?? '';
    const model = response.headers.get('x-anthropic-model') ?? '';

    await prisma.evaluation.create({
      data: {
        submissionId,
        rubricJson: rubric as any,
        promptSha256,
        model,
        banderaParaPapa: rubric.bandera_para_papa ?? null,
        calidadFotoUsable: rubric.calidad_foto?.usable ?? false,
      },
    });

    if (Array.isArray(rubric.huella_estilo)) {
      for (const text of rubric.huella_estilo) {
        await prisma.styleTrait.create({ data: { submissionId, text } });
      }
    }

    await transitionStatus(submissionId, ['evaluating'], 'evaluated');
  } catch (err) {
    // BullMQ no loguea el motivo por su cuenta — sin esto, un fallo aquí no deja
    // ningún rastro (el estado pasa a 'failed' pero el "por qué" solo vive en
    // Redis hasta que el job se limpie). Necesario para poder diagnosticar.
    console.error(`Falló la evaluación de submission ${submissionId}:`, err);
    await transitionStatus(submissionId, ['evaluating'], 'failed');
    throw err; // BullMQ registra el fallo y aplica attempts/backoff de la cola.
  }
}

export function startEvaluationWorker(options: Partial<WorkerOptions> = {}): Worker<EvaluationJobData> {
  const connection = createRedisConnection();
  return new Worker<EvaluationJobData>('evaluation', processEvaluationJob, {
    connection,
    concurrency: 1,
    ...options,
  });
}
