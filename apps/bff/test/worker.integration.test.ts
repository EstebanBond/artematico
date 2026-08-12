import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Queue, Worker } from 'bullmq';

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let fakeEvaluatorServer: http.Server;
let fakeEvaluatorPort: number;
let prisma: PrismaClient;
let worker: Worker;
let evaluationQueue: Queue;
let enqueueEvaluation: (submissionId: string) => Promise<void>;
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

  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taller-worker-uploads-'));
  process.env.UPLOAD_DIR = uploadDir;

  // Servidor HTTP real que simula /evaluate del evaluator (rebanada 03).
  fakeEvaluatorServer = http.createServer((req, res) => {
    if (req.url === '/evaluate' && req.method === 'POST') {
      req.resume(); // consume el body sin parsearlo, no importa para este test
      req.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Prompt-Sha256': 'fakehash123',
          'X-Anthropic-Model': 'claude-sonnet-5',
        });
        res.end(JSON.stringify({
          tecnica: 'grafito_linea',
          criterios_foco: [{ criterio: 'trazo_linea', nivel: 2, evidencia: 'El trazo del brazo derecho tiene varios repasos.' }],
          lo_que_funciona: 'La proporción de la cabeza respecto al cuerpo es consistente en todo el dibujo.',
          lo_que_sigue: 'Marca primero las líneas guía del brazo antes de trazar el contorno final.',
          micro_ejercicio: { instruccion: 'Dibuja diez óvalos rápidos de 30 segundos cada uno sin levantar el lápiz.', minutos: 5 },
          huella_estilo: ['Prefiere encuadres cerrados, casi sin fondo.'],
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
  const workerModule = await import('../src/worker.js');

  worker = workerModule.startEvaluationWorker();
  evaluationQueue = queueModule.evaluationQueue;
  enqueueEvaluation = queueModule.enqueueEvaluation;
}, 60_000);

afterAll(async () => {
  await worker?.close();
  // Sin esto, la conexión ioredis de la cola queda abierta cuando el contenedor
  // de Redis se detiene abajo, y se ve un "Unhandled error event: ECONNRESET" en
  // stderr (no falla el test, pero ensucia los logs y tapa errores reales en CI).
  await evaluationQueue?.close();
  await prisma?.$disconnect();
  await pgContainer?.stop();
  await redisContainer?.stop();
  await new Promise<void>((resolve) => fakeEvaluatorServer.close(() => resolve()));
  await fs.rm(uploadDir, { recursive: true, force: true });
});

describe('BullMQ worker: camino feliz', () => {
  it('procesa uploaded -> queued -> evaluating -> evaluated, crea Evaluation y StyleTrait', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 1, dayIndex: 1, technique: 'grafito_linea', tema: 'Aprender a observar',
        papel: 'bond_75', consigna: 'Dibuja un objeto de tu casa.', criteriosFoco: ['trazo_linea'],
      },
    });

    const submission = await prisma.submission.create({
      data: { idempotencyKey: 'worker-test-001', objectKey: 'submissions/worker-test-001.jpg', studentId: 'test', sessionNumber: 1, lessonId: lesson.id },
    });

    const objectPath = path.join(uploadDir, submission.objectKey);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });
    await fs.writeFile(objectPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));

    await enqueueEvaluation(submission.id);

    // Espera activa a que el worker termine (hasta 15s).
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
    expect(evaluation?.promptSha256).toBe('fakehash123');
    expect(evaluation?.calidadFotoUsable).toBe(true);

    const traits = await prisma.styleTrait.findMany({ where: { submissionId: submission.id } });
    expect(traits).toHaveLength(1);
  });
});
