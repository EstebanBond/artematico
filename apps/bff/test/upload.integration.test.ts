import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

let container: StartedTestContainer;
let prisma: PrismaClient;
let app: Express;
let agent: ReturnType<typeof request.agent>;
let uploadDir: string;
let lessonId: string;

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_DB: 'taller_test', POSTGRES_USER: 'taller', POSTGRES_PASSWORD: 'test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const port = container.getMappedPort(5432);
  const host = container.getHost();
  const databaseUrl = `postgresql://taller:test@${host}:${port}/taller_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.STUDENTS = 'test:test-pin-0000:Test,test2:test-pin-0001:Test2';
  process.env.COOKIE_SECRET = 'test-cookie-secret';

  uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taller-uploads-'));
  process.env.UPLOAD_DIR = uploadDir;

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const dbModule = await import('../src/db.js');
  prisma = dbModule.prisma;
  const appModule = await import('../src/app.js');
  app = await appModule.createApp();

  // /upload queda detrás del gate de PIN (rebanada 10) — el agent persiste la
  // cookie de sesión firmada entre requests, como haría un navegador real.
  agent = request.agent(app);
  const loginRes = await agent.post('/auth/pin').send({ pin: 'test-pin-0000' });
  if (loginRes.status !== 200) {
    throw new Error(`No se pudo autenticar en el setup del test: ${loginRes.status}`);
  }

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
  lessonId = lesson.id;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
  await fs.rm(uploadDir, { recursive: true, force: true });
});

describe('POST /upload', () => {
  it('crea un Submission con una imagen válida', async () => {
    const res = await agent
      .post('/upload')
      .set('Idempotency-Key', 'test-key-001')
      .field('lessonId', lessonId)
      .field('sessionNumber', '1')
      .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xdb]), { filename: 'test.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.idempotent).toBe(false);
    expect(res.body.objectKey).toBe('submissions/test-key-001.jpg');
  });

  it('un segundo POST con la MISMA idempotency key crea un solo registro (no duplica)', async () => {
    const key = 'test-key-002';
    const doUpload = () =>
      agent
        .post('/upload')
        .set('Idempotency-Key', key)
        .field('lessonId', lessonId)
        .field('sessionNumber', '2')
        .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xdb]), { filename: 'test.jpg', contentType: 'image/jpeg' });

    const first = await doUpload();
    const second = await doUpload();

    expect(first.status).toBe(201);
    expect(first.body.idempotent).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.submissionId).toBe(first.body.submissionId);

    const count = await prisma.submission.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it('rechaza sin el header Idempotency-Key', async () => {
    const res = await agent
      .post('/upload')
      .field('lessonId', lessonId)
      .field('sessionNumber', '3')
      .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xdb]), { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('rechaza una Idempotency-Key con caracteres de path traversal', async () => {
    const res = await agent
      .post('/upload')
      .set('Idempotency-Key', '../../etc/cron.d/evil')
      .field('lessonId', lessonId)
      .field('sessionNumber', '99')
      .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xdb]), { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('rechaza un content-type no permitido', async () => {
    const res = await agent
      .post('/upload')
      .set('Idempotency-Key', 'test-key-003')
      .field('lessonId', lessonId)
      .field('sessionNumber', '4')
      .attach('image', Buffer.from('not an image'), { filename: 'test.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('rechaza un lessonId inexistente', async () => {
    const res = await agent
      .post('/upload')
      .set('Idempotency-Key', 'test-key-004')
      .field('lessonId', 'lesson-que-no-existe')
      .field('sessionNumber', '5')
      .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xdb]), { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });

  it('sessionNumber es independiente por estudiante (dos hermanos subiendo intercalado no comparten numeración)', async () => {
    const agent2 = request.agent(app);
    const login2 = await agent2.post('/auth/pin').send({ pin: 'test-pin-0001' });
    expect(login2.status).toBe(200);

    const upload = (a: typeof agent, key: string) =>
      a
        .post('/upload')
        .set('Idempotency-Key', key)
        .field('lessonId', lessonId)
        .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xdb]), { filename: 'test.jpg', contentType: 'image/jpeg' });

    // Intercalado: hermano 1, hermano 2, hermano 1 de nuevo.
    const r1a = await upload(agent, 'interleave-test-1a');
    const r2a = await upload(agent2, 'interleave-test-2a');
    const r1b = await upload(agent, 'interleave-test-1b');

    const sub1a = await prisma.submission.findUniqueOrThrow({ where: { id: r1a.body.submissionId } });
    const sub2a = await prisma.submission.findUniqueOrThrow({ where: { id: r2a.body.submissionId } });
    const sub1b = await prisma.submission.findUniqueOrThrow({ where: { id: r1b.body.submissionId } });

    expect(sub1a.studentId).toBe('test');
    expect(sub2a.studentId).toBe('test2');
    // El segundo envío de "test" es su sesión N+1, sin importar cuántas subió
    // "test2" en medio — cada estudiante tiene su propia numeración.
    expect(sub1b.sessionNumber).toBe(sub1a.sessionNumber + 1);
  });
});
