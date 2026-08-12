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

  // /graphql queda detrás del gate de PIN (rebanada 10) — el agent persiste la
  // cookie de sesión firmada entre requests, como haría un navegador real.
  agent = request.agent(app);
  const loginRes = await agent.post('/auth/pin').send({ pin: 'test-pin-0000' });
  if (loginRes.status !== 200) {
    throw new Error(`No se pudo autenticar en el setup del test: ${loginRes.status}`);
  }

  const lesson1 = await prisma.lesson.create({
    data: {
      week: 1,
      dayIndex: 1,
      technique: 'grafito_linea',
      tema: 'Aprender a observar',
      papel: 'bond_75',
      consigna: 'Dibuja un objeto de tu casa.',
      criteriosFoco: ['trazo_linea'],
      videoUrl: 'https://example.com/video1',
    },
  });
  await prisma.lesson.create({
    data: {
      week: 1,
      dayIndex: 2,
      technique: 'grafito_linea',
      tema: 'Proporción',
      papel: 'bond_75',
      consigna: 'Dibuja una silla.',
      criteriosFoco: ['proporcion_escala'],
    },
  });

  await prisma.submission.create({
    data: { idempotencyKey: 'seed-1', objectKey: 'a.jpg', studentId: 'test', sessionNumber: 1, lessonId: lesson1.id },
  });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

describe('GraphQL Query.today', () => {
  it('devuelve la primera lección sin evaluar y los últimos envíos', async () => {
    const res = await agent
      .post('/graphql')
      .send({
        query: '{ today { lesson { week dayIndex tema videoUrl criteriosFoco } recentSubmissions { id status objectKey sessionNumber } } }',
      });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.today.lesson.week).toBe(1);
    expect(res.body.data.today.lesson.dayIndex).toBe(1);
    expect(res.body.data.today.lesson.videoUrl).toBe('https://example.com/video1');
    expect(res.body.data.today.recentSubmissions).toHaveLength(1);
    expect(res.body.data.today.recentSubmissions[0].objectKey).toBe('a.jpg');
  });
});
