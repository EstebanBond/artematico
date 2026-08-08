import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Queue, Worker } from 'bullmq';
import request from 'supertest';
import type { Express } from 'express';

let pgContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let fakeEvaluatorServer: http.Server;
let fakeEvaluatorPort: number;
let prisma: PrismaClient;
let worker: Worker;
let evaluationQueue: Queue;
let enqueueEvaluation: (submissionId: string) => Promise<void>;
let uploadDir: string;
let app: Express;
let agent: ReturnType<typeof request.agent>;

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
  process.env.FAMILY_PIN = 'test-pin-0000';
  process.env.COOKIE_SECRET = 'test-cookie-secret';

  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taller-submit-eval-uploads-'));
  process.env.UPLOAD_DIR = uploadDir;

  // Servidor HTTP real que simula /evaluate del evaluator (rebanada 03).
  fakeEvaluatorServer = http.createServer((req, res) => {
    if (req.url === '/evaluate' && req.method === 'POST') {
      req.resume();
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
  const appModule = await import('../src/app.js');

  worker = workerModule.startEvaluationWorker();
  evaluationQueue = queueModule.evaluationQueue;
  enqueueEvaluation = queueModule.enqueueEvaluation;
  app = await appModule.createApp();

  // /graphql queda detrás del gate de PIN (rebanada 10) — el agent persiste la
  // cookie de sesión firmada entre requests, como haría un navegador real.
  agent = request.agent(app);
  const loginRes = await agent.post('/auth/pin').send({ pin: 'test-pin-0000' });
  if (loginRes.status !== 200) {
    throw new Error(`No se pudo autenticar en el setup del test: ${loginRes.status}`);
  }
}, 60_000);

afterAll(async () => {
  await worker?.close();
  await evaluationQueue?.close();
  await prisma?.$disconnect();
  await pgContainer?.stop();
  await redisContainer?.stop();
  await new Promise<void>((resolve) => fakeEvaluatorServer.close(() => resolve()));
  await fs.rm(uploadDir, { recursive: true, force: true });
});

describe('submitForEvaluation mutation', () => {
  it('no bloquea: responde con status queued en < 2s', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 1, dayIndex: 1, technique: 'grafito_linea', tema: 'Aprender a observar',
        papel: 'bond_75', consigna: 'Dibuja un objeto de tu casa.', criteriosFoco: ['trazo_linea'],
      },
    });

    const submission = await prisma.submission.create({
      data: { idempotencyKey: 'no-block-test-001', objectKey: 'submissions/no-block-test-001.jpg', sessionNumber: 1, lessonId: lesson.id },
    });

    const objectPath = path.join(uploadDir, submission.objectKey);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });
    await fs.writeFile(objectPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));

    const start = Date.now();
    const res = await agent
      .post('/graphql')
      .send({
        query: `mutation($id: ID!, $ratings: [CriterioRatingInput!]!) {
          submitForEvaluation(submissionId: $id, ratings: $ratings) {
            id status
          }
        }`,
        variables: { id: submission.id, ratings: [{ criterio: 'trazo_linea', nivel: 2 }] },
      });
    const duration = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.data?.submitForEvaluation).toBeDefined();
    expect(res.body.data.submitForEvaluation.status).toBe('queued');
    expect(duration).toBeLessThan(2000);
  });

  it('polling hasta completarse: status pasa a evaluated con evaluation data', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 2, dayIndex: 1, technique: 'grafito_linea', tema: 'Observación profunda',
        papel: 'bond_75', consigna: 'Dibuja tu planta favorita.', criteriosFoco: ['trazo_linea'],
      },
    });

    const submission = await prisma.submission.create({
      data: { idempotencyKey: 'polling-test-001', objectKey: 'submissions/polling-test-001.jpg', sessionNumber: 1, lessonId: lesson.id },
    });

    const objectPath = path.join(uploadDir, submission.objectKey);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });
    await fs.writeFile(objectPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));

    await agent
      .post('/graphql')
      .send({
        query: `mutation($id: ID!, $ratings: [CriterioRatingInput!]!) {
          submitForEvaluation(submissionId: $id, ratings: $ratings) { id }
        }`,
        variables: { id: submission.id, ratings: [{ criterio: 'trazo_linea', nivel: 2 }] },
      });

    // Polling cada 300ms hasta que status sea 'evaluated' (máx 20s).
    let finalStatus = '';
    let evaluation: any = null;
    for (let i = 0; i < 67; i++) {
      const res = await agent
        .post('/graphql')
        .send({
          query: `query($id: ID!) {
            submission(id: $id) {
              status
              evaluation {
                loQueFunciona
                loQueSigue
                microEjercicio { instruccion minutos }
                huellaEstilo
              }
            }
          }`,
          variables: { id: submission.id },
        });
      finalStatus = res.body.data?.submission?.status;
      evaluation = res.body.data?.submission?.evaluation;
      if (finalStatus === 'evaluated' || finalStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 300));
    }

    expect(finalStatus).toBe('evaluated');
    expect(evaluation).toBeDefined();
    expect(evaluation.loQueFunciona).toBe('La proporción de la cabeza respecto al cuerpo es consistente en todo el dibujo.');
    expect(evaluation.loQueSigue).toBe('Marca primero las líneas guía del brazo antes de trazar el contorno final.');
    expect(evaluation.microEjercicio.instruccion).toBe('Dibuja diez óvalos rápidos de 30 segundos cada uno sin levantar el lápiz.');
    expect(evaluation.microEjercicio.minutos).toBe(5);
    expect(evaluation.huellaEstilo).toContain('Prefiere encuadres cerrados, casi sin fondo.');
  });

  it('rechaza si submission no existe', async () => {
    const res = await agent
      .post('/graphql')
      .send({
        query: `mutation($id: ID!, $ratings: [CriterioRatingInput!]!) {
          submitForEvaluation(submissionId: $id, ratings: $ratings) { id }
        }`,
        variables: { id: 'nonexistent-id', ratings: [{ criterio: 'trazo_linea', nivel: 2 }] },
      });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors[0].message).toContain('Submission no encontrado');
  });

  it('rechaza segundo envío del mismo submission (no está en uploaded)', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 3, dayIndex: 1, technique: 'grafito_linea', tema: 'Técnica avanzada',
        papel: 'bond_75', consigna: 'Dibuja un retrato.', criteriosFoco: ['trazo_linea'],
      },
    });

    const submission = await prisma.submission.create({
      data: { idempotencyKey: 'double-submit-test-001', objectKey: 'submissions/double-submit-test-001.jpg', sessionNumber: 1, lessonId: lesson.id },
    });

    const objectPath = path.join(uploadDir, submission.objectKey);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });
    await fs.writeFile(objectPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));

    // Primer envío: debe funcionar
    const res1 = await agent
      .post('/graphql')
      .send({
        query: `mutation($id: ID!, $ratings: [CriterioRatingInput!]!) {
          submitForEvaluation(submissionId: $id, ratings: $ratings) { id status }
        }`,
        variables: { id: submission.id, ratings: [{ criterio: 'trazo_linea', nivel: 2 }] },
      });
    expect(res1.body.data?.submitForEvaluation?.status).toBe('queued');

    // Segundo envío: debe fallar (ya no está en 'uploaded', puede estar en queued/evaluating/evaluated)
    const res2 = await agent
      .post('/graphql')
      .send({
        query: `mutation($id: ID!, $ratings: [CriterioRatingInput!]!) {
          submitForEvaluation(submissionId: $id, ratings: $ratings) { id }
        }`,
        variables: { id: submission.id, ratings: [{ criterio: 'trazo_linea', nivel: 3 }] },
      });
    expect(res2.body.errors).toBeDefined();
    expect(res2.body.errors[0].message).toMatch(/ya está en estado '(queued|evaluating|evaluated)'/);
  });

  it('respeta MAX_EVALS_PER_DAY: rechaza si se alcanzó el límite', async () => {
    // Limpia los submissions de HOY que estén en queued/evaluating/evaluated
    // para que este test sea aislado (primero limpia los related records)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const submissionsToDelete = await prisma.submission.findMany({
      where: {
        createdAt: { gte: startOfDay },
        status: { in: ['queued', 'evaluating', 'evaluated'] },
      },
      select: { id: true },
    });
    for (const sub of submissionsToDelete) {
      await prisma.evaluation.deleteMany({ where: { submissionId: sub.id } });
      await prisma.selfAssessment.deleteMany({ where: { submissionId: sub.id } });
      await prisma.styleTrait.deleteMany({ where: { submissionId: sub.id } });
    }
    await prisma.submission.deleteMany({
      where: {
        createdAt: { gte: startOfDay },
        status: { in: ['queued', 'evaluating', 'evaluated'] },
      },
    });

    // Setea el límite a 1 para este test
    process.env.MAX_EVALS_PER_DAY = '1';

    const lesson = await prisma.lesson.create({
      data: {
        week: 4, dayIndex: 1, technique: 'grafito_linea', tema: 'Límite de evals',
        papel: 'bond_75', consigna: 'Dibuja algo.', criteriosFoco: ['trazo_linea'],
      },
    });

    // Crear dos submissions distintos
    const submission1 = await prisma.submission.create({
      data: { idempotencyKey: 'limit-test-001', objectKey: 'submissions/limit-test-001.jpg', sessionNumber: 1, lessonId: lesson.id },
    });
    const submission2 = await prisma.submission.create({
      data: { idempotencyKey: 'limit-test-002', objectKey: 'submissions/limit-test-002.jpg', sessionNumber: 2, lessonId: lesson.id },
    });

    // Escribir los archivos
    for (const sub of [submission1, submission2]) {
      const objectPath = path.join(uploadDir, sub.objectKey);
      await fs.mkdir(path.dirname(objectPath), { recursive: true });
      await fs.writeFile(objectPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
    }

    // Primer envío: debe funcionar
    const res1 = await agent
      .post('/graphql')
      .send({
        query: `mutation($id: ID!, $ratings: [CriterioRatingInput!]!) {
          submitForEvaluation(submissionId: $id, ratings: $ratings) { id status }
        }`,
        variables: { id: submission1.id, ratings: [{ criterio: 'trazo_linea', nivel: 2 }] },
      });
    expect(res1.body.data?.submitForEvaluation?.status).toBe('queued');

    // Segundo envío: debe fallar (alcanzó el límite de 1)
    const res2 = await agent
      .post('/graphql')
      .send({
        query: `mutation($id: ID!, $ratings: [CriterioRatingInput!]!) {
          submitForEvaluation(submissionId: $id, ratings: $ratings) { id }
        }`,
        variables: { id: submission2.id, ratings: [{ criterio: 'trazo_linea', nivel: 2 }] },
      });
    expect(res2.body.errors).toBeDefined();
    expect(res2.body.errors[0].message).toContain('máximo de 1 evaluaciones por día');

    // Restaura el valor original
    process.env.MAX_EVALS_PER_DAY = '3';
  });
});
