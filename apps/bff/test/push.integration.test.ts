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
  process.env.STUDENTS = 'jorge:test-pin-0000:Jorge';
  process.env.COOKIE_SECRET = 'test-cookie-secret';
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const dbModule = await import('../src/db.js');
  prisma = dbModule.prisma;
  const appModule = await import('../src/app.js');
  app = await appModule.createApp();

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

describe('GET /push/vapid-public-key', () => {
  it('devuelve la llave pública configurada', async () => {
    const res = await agent.get('/push/vapid-public-key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ publicKey: 'test-public-key' });
  });

  it('sin autenticación devuelve 401', async () => {
    const res = await request(app).get('/push/vapid-public-key');
    expect(res.status).toBe(401);
  });
});

describe('POST /push/subscribe', () => {
  it('guarda la suscripción con el studentId de la sesión, no uno inventado en el body', async () => {
    const res = await agent.post('/push/subscribe').send({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      studentId: 'georgina', // debe ignorarse — no existe ese estudiante en STUDENTS de este test
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    });

    expect(res.status).toBe(200);

    const stored = await prisma.pushSubscription.findUniqueOrThrow({
      where: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' },
    });
    expect(stored.studentId).toBe('jorge');
  });

  it('un segundo subscribe con el mismo endpoint actualiza en vez de duplicar', async () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
    await agent.post('/push/subscribe').send({
      endpoint,
      keys: { p256dh: 'p256dh-nuevo', auth: 'auth-nuevo' },
    });

    const count = await prisma.pushSubscription.count({ where: { endpoint } });
    expect(count).toBe(1);
    const stored = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint } });
    expect(stored.p256dh).toBe('p256dh-nuevo');
  });

  it('rechaza un endpoint que no sea de un servicio de push conocido (evita SSRF)', async () => {
    const res = await agent.post('/push/subscribe').send({
      endpoint: 'http://169.254.169.254/latest/meta-data/',
      keys: { p256dh: 'x', auth: 'y' },
    });
    expect(res.status).toBe(400);
  });

  it('sin autenticación devuelve 401', async () => {
    const res = await request(app).post('/push/subscribe').send({
      endpoint: 'https://fcm.googleapis.com/fcm/send/no-auth',
      keys: { p256dh: 'x', auth: 'y' },
    });
    expect(res.status).toBe(401);
  });
});
