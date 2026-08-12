import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

let container: StartedTestContainer;
let prisma: PrismaClient;
let app: Express;
let agent: ReturnType<typeof request.agent>;

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_DB: 'taller_test', POSTGRES_USER: 'taller', POSTGRES_PASSWORD: 'test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const databaseUrl = `postgresql://taller:test@${container.getHost()}:${container.getMappedPort(5432)}/taller_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.STUDENTS = 'test:test-pin-0000:Test';
  process.env.COOKIE_SECRET = 'test-cookie-secret';

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const dbModule = await import('../src/db.js');
  prisma = dbModule.prisma;
  const appModule = await import('../src/app.js');
  app = await appModule.createApp();

  // /print-package queda detrás del gate de PIN (rebanada 10) — el agent persiste la
  // cookie de sesión firmada entre requests, como haría un navegador real.
  agent = request.agent(app);
  const loginRes = await agent.post('/auth/pin').send({ pin: 'test-pin-0000' });
  if (loginRes.status !== 200) {
    throw new Error(`No se pudo autenticar en el setup del test: ${loginRes.status}`);
  }
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

describe('GET /print-package', () => {
  it('sin studentId devuelve 400', async () => {
    const res = await agent.get('/print-package');
    expect(res.status).toBe(400);
  });

  it('sin sesiones evaluadas devuelve 404', async () => {
    const res = await agent.get('/print-package?studentId=test');
    expect(res.status).toBe(404);
  });

  it('sin autenticación devuelve 401', async () => {
    const res = await request(app).get('/print-package?studentId=test');
    expect(res.status).toBe(401);
  });

  it('con una sesión evaluada completa genera un PDF válido descargable', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 1,
        dayIndex: 1,
        technique: 'grafito_linea',
        tema: 'Aprender a observar',
        papel: 'bond_75',
        consigna: 'Dibuja un objeto de tu casa.',
        criteriosFoco: ['trazo_linea'],
      },
    });

    const submission = await prisma.submission.create({
      data: {
        idempotencyKey: 'print-package-test-001',
        objectKey: 'submissions/print-package-test-001.jpg',
        studentId: 'test',
        sessionNumber: 1,
        lessonId: lesson.id,
        status: 'evaluated',
      },
    });

    await prisma.selfAssessment.create({
      data: {
        submissionId: submission.id,
        ratings: { trazo_linea: 2 },
      },
    });

    await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        promptSha256: 'fakehash123',
        model: 'claude-sonnet-5',
        banderaParaPapa: null,
        calidadFotoUsable: true,
        rubricJson: {
          tecnica: 'grafito_linea',
          criterios_foco: [
            { criterio: 'trazo_linea', nivel: 2, evidencia: 'El trazo del brazo derecho tiene varios repasos.' },
          ],
          lo_que_funciona: 'La proporción de la cabeza respecto al cuerpo es consistente en todo el dibujo.',
          lo_que_sigue: 'Marca primero las líneas guía del brazo antes de trazar el contorno final.',
          micro_ejercicio: {
            instruccion: 'Dibuja diez óvalos rápidos de 30 segundos cada uno sin levantar el lápiz.',
            minutos: 5,
          },
          huella_estilo: ['Prefiere encuadres cerrados, casi sin fondo.'],
          bandera_para_papa: null,
          calidad_foto: { usable: true, problemas: [] },
        },
      },
    });

    await prisma.styleTrait.createMany({
      data: [
        { submissionId: submission.id, text: 'Prefiere encuadres cerrados, casi sin fondo.' },
        { submissionId: submission.id, text: 'Usa trazos cortos y repetidos.' },
      ],
    });

    const res = await agent.get('/print-package?studentId=test').buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');

    const pdfBuffer = res.body as Buffer;
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(0);
    expect(pdfBuffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });
});
