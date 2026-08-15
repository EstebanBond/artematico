import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetailsMock(...args),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}));

let container: StartedTestContainer;
let prisma: PrismaClient;
let processReminderJob: () => Promise<void>;

const JORGE_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/jorge-test';
const MARCO_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/marco-test';
const GEORGINA_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/georgina-test';

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_DB: 'taller_test', POSTGRES_USER: 'taller', POSTGRES_PASSWORD: 'test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const databaseUrl = `postgresql://taller:test@${container.getHost()}:${container.getMappedPort(5432)}/taller_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.STUDENTS = 'jorge:1111:Jorge,georgina:2222:Georgina,marco:3333:Marco';
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
  const reminderModule = await import('../src/reminderWorker.js');
  processReminderJob = reminderModule.processReminderJob;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

describe('processReminderJob', () => {
  it('manda push solo a estudiantes sin submissions hoy, y limpia suscripciones vencidas (410)', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 1, dayIndex: 1, technique: 'grafito_linea', tema: 'Aprender a observar',
        papel: 'bond_75', consigna: 'Dibuja un objeto de tu casa.', criteriosFoco: ['trazo_linea'],
      },
    });

    // Georgina ya subió algo hoy -> no debe recibir recordatorio.
    await prisma.submission.create({
      data: {
        idempotencyKey: 'reminder-test-georgina', objectKey: 'a.jpg',
        studentId: 'georgina', sessionNumber: 1, lessonId: lesson.id,
      },
    });

    await prisma.pushSubscription.create({
      data: { studentId: 'jorge', endpoint: JORGE_ENDPOINT, p256dh: 'p256dh-jorge', auth: 'auth-jorge' },
    });
    await prisma.pushSubscription.create({
      data: { studentId: 'georgina', endpoint: GEORGINA_ENDPOINT, p256dh: 'p256dh-georgina', auth: 'auth-georgina' },
    });
    await prisma.pushSubscription.create({
      data: { studentId: 'marco', endpoint: MARCO_ENDPOINT, p256dh: 'p256dh-marco', auth: 'auth-marco' },
    });

    sendNotificationMock.mockImplementation(async (subscription: { endpoint: string }) => {
      if (subscription.endpoint === MARCO_ENDPOINT) {
        const err = Object.assign(new Error('Gone'), { statusCode: 410 });
        throw err;
      }
      return {};
    });

    await processReminderJob();

    const calledEndpoints = sendNotificationMock.mock.calls.map(
      (call) => (call[0] as { endpoint: string }).endpoint,
    );
    expect(calledEndpoints).toContain(JORGE_ENDPOINT);
    expect(calledEndpoints).toContain(MARCO_ENDPOINT);
    expect(calledEndpoints).not.toContain(GEORGINA_ENDPOINT);

    const jorgeCall = sendNotificationMock.mock.calls.find(
      (call) => (call[0] as { endpoint: string }).endpoint === JORGE_ENDPOINT,
    );
    const payload = JSON.parse(jorgeCall![1] as string) as { title: string; body: string };
    expect(payload.body).toContain('Jorge');

    // La suscripción de marco recibió 410 -> se debe haber borrado.
    const marcoSub = await prisma.pushSubscription.findUnique({ where: { endpoint: MARCO_ENDPOINT } });
    expect(marcoSub).toBeNull();

    // La de jorge (sin error) sigue existiendo.
    const jorgeSub = await prisma.pushSubscription.findUnique({ where: { endpoint: JORGE_ENDPOINT } });
    expect(jorgeSub).not.toBeNull();
  });
});
