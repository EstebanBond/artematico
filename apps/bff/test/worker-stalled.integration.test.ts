import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Queue, Worker } from 'bullmq';

// Prueba el requisito "matar el worker re-encola": un worker que muere DESPUÉS de
// tomar el job (ya transicionó a 'evaluating') no debe dejar el Submission atascado
// para siempre — BullMQ detecta el lock vencido (stalled job), lo regresa a la cola,
// y otro worker debe retomarlo y terminarlo. lockDuration/stalledInterval se
// configuran cortos SOLO para que la prueba sea rápida; en producción se usan los
// valores por defecto de BullMQ.

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let fakeEvaluatorServer: http.Server;
let fakeEvaluatorPort: number;
let prisma: PrismaClient;
let evaluationQueue: Queue;
let enqueueEvaluation: (submissionId: string) => Promise<void>;
let createRedisConnection: () => import('ioredis').Redis;
let startEvaluationWorker: (options?: Record<string, unknown>) => Worker;
let uploadDir: string;

beforeAll(async () => {
  pgContainer = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_DB: 'taller_test', POSTGRES_USER: 'taller', POSTGRES_PASSWORD: 'test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections', 1))
    .start();

  const databaseUrl = `postgresql://taller:test@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/taller_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taller-worker-stalled-'));
  process.env.UPLOAD_DIR = uploadDir;

  // Servidor HTTP real simulando /evaluate (mismo contrato de rebanada 03).
  fakeEvaluatorServer = http.createServer((req, res) => {
    if (req.url === '/evaluate' && req.method === 'POST') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Prompt-Sha256': 'fakehash-stalled',
          'X-Anthropic-Model': 'claude-sonnet-5',
        });
        res.end(JSON.stringify({
          tecnica: 'grafito_linea',
          criterios_foco: [{ criterio: 'trazo_linea', nivel: 2, evidencia: 'El trazo del brazo derecho tiene varios repasos.' }],
          lo_que_funciona: 'La proporción de la cabeza respecto al cuerpo es consistente en todo el dibujo.',
          lo_que_sigue: 'Marca primero las líneas guía del brazo antes de trazar el contorno final.',
          micro_ejercicio: { instruccion: 'Dibuja diez óvalos rápidos de 30 segundos cada uno sin levantar el lápiz.', minutos: 5 },
          huella_estilo: [],
          bandera_para_papa: null,
          calidad_foto: { usable: true, problemas: [] },
        }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => fakeEvaluatorServer.listen(0, resolve));
  fakeEvaluatorPort = (fakeEvaluatorServer.address() as { port: number }).port;
  process.env.EVALUATOR_URL = `http://localhost:${fakeEvaluatorPort}`;

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const dbModule = await import('../src/db.js');
  prisma = dbModule.prisma;
  const queueModule = await import('../src/queue.js');
  evaluationQueue = queueModule.evaluationQueue;
  enqueueEvaluation = queueModule.enqueueEvaluation;
  const redisModule = await import('../src/redis.js');
  createRedisConnection = redisModule.createRedisConnection;
  const workerModule = await import('../src/worker.js');
  startEvaluationWorker = workerModule.startEvaluationWorker;
}, 60_000);

afterAll(async () => {
  await evaluationQueue?.close();
  await prisma?.$disconnect();
  await pgContainer?.stop();
  await redisContainer?.stop();
  await new Promise<void>((resolve) => fakeEvaluatorServer.close(() => resolve()));
  await fs.rm(uploadDir, { recursive: true, force: true });
});

describe('BullMQ worker: matar el worker re-encola (stalled job)', () => {
  it('un job cuyo worker muere a medio proceso (ya en evaluating) es retomado y completado por otro worker', async () => {
    const { Worker: BullWorker } = await import('bullmq');

    const lesson = await prisma.lesson.create({
      data: {
        week: 3, dayIndex: 1, technique: 'grafito_linea', tema: 'Tema stalled-test',
        papel: 'bond_75', consigna: 'Dibuja algo.', criteriosFoco: ['trazo_linea'],
      },
    });
    const submission = await prisma.submission.create({
      data: {
        idempotencyKey: 'stalled-test-001',
        objectKey: 'submissions/stalled-test-001.jpg',
        studentId: 'test',
        sessionNumber: 1,
        lessonId: lesson.id,
      },
    });
    const objectPath = path.join(uploadDir, submission.objectKey);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });
    await fs.writeFile(objectPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));

    // Worker A: toma el job, transiciona a 'evaluating' (como lo haría el
    // procesador real al empezar), avisa que arrancó, y luego CUELGA para
    // siempre — simula un proceso que murió (crash/OOM/kill -9) a medio trabajo,
    // sin nunca llegar a terminar ni renovar su lock.
    let workerAStarted!: () => void;
    const workerAStartedPromise = new Promise<void>((resolve) => {
      workerAStarted = resolve;
    });
    const { transitionStatus } = await import('../src/stateMachine.js');

    const workerA = new BullWorker(
      'evaluation',
      async (job: { data: { submissionId: string } }) => {
        await transitionStatus(job.data.submissionId, ['queued'], 'evaluating');
        workerAStarted();
        await new Promise(() => {}); // nunca resuelve
      },
      { connection: createRedisConnection(), lockDuration: 1000, stalledInterval: 500 },
    );

    await enqueueEvaluation(submission.id);
    await workerAStartedPromise;

    // Confirma que efectivamente quedó en 'evaluating' antes de "matar" el worker.
    const midway = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(midway.status).toBe('evaluating');

    // "Matar" el worker: close(force=true) no espera al job activo y deja de
    // renovar su lock — desde la perspectiva de BullMQ, es indistinguible de un
    // proceso que murió sin avisar.
    await workerA.close(true);

    // Worker B: el procesador REAL de producción, con los mismos timings cortos
    // para que la prueba no tarde los 30s por defecto de BullMQ.
    const workerB = startEvaluationWorker({ lockDuration: 1000, stalledInterval: 500 });

    let finalStatus = '';
    for (let i = 0; i < 30; i++) {
      const current = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } });
      finalStatus = current.status;
      if (finalStatus === 'evaluated' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    expect(finalStatus).toBe('evaluated');

    const evaluation = await prisma.evaluation.findUnique({ where: { submissionId: submission.id } });
    expect(evaluation).not.toBeNull();
    expect(evaluation?.promptSha256).toBe('fakehash-stalled');

    await workerB.close();
  }, 30_000);
});
