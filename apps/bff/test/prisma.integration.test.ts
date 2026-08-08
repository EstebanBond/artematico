import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let container: StartedTestContainer;
let prisma: PrismaClient;

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

  // Aplica las migraciones ya generadas (prisma/migrations/) contra este Postgres efímero.
  execSync('npx prisma migrate deploy', {
    cwd: __dirname + '/..',
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

describe('Prisma schema (Postgres real vía Testcontainers)', () => {
  it('crea Lesson -> Submission -> SelfAssessment -> Evaluation -> StyleTrait y respeta las relaciones', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 1, dayIndex: 1, technique: 'grafito_linea', tema: 'Aprender a observar',
        papel: 'bond_75', consigna: 'Dibuja un objeto de tu casa.',
        criteriosFoco: ['trazo_linea'],
      },
    });

    const submission = await prisma.submission.create({
      data: {
        idempotencyKey: 'idem-key-001', objectKey: 'uploads/2026/08/06/foto1.jpg',
        sessionNumber: 1, lessonId: lesson.id,
      },
    });

    await prisma.selfAssessment.create({
      data: { submissionId: submission.id, ratings: { trazo_linea: 2 } },
    });

    const evaluation = await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        rubricJson: { tecnica: 'grafito_linea', criterios_foco: [{ criterio: 'trazo_linea', nivel: 2, evidencia: 'x' }] },
        promptSha256: 'abc123', model: 'claude-sonnet-5',
        banderaParaPapa: null, calidadFotoUsable: true,
      },
    });

    await prisma.styleTrait.create({
      data: { submissionId: submission.id, text: 'Prefiere encuadres cerrados.' },
    });

    const found = await prisma.submission.findUniqueOrThrow({
      where: { id: submission.id },
      include: { selfAssessment: true, evaluation: true, styleTraits: true, lesson: true },
    });

    expect(found.selfAssessment?.ratings).toEqual({ trazo_linea: 2 });
    expect(found.evaluation?.id).toBe(evaluation.id);
    expect(found.styleTraits).toHaveLength(1);
    expect(found.lesson.week).toBe(1);
  });

  it('rechaza un idempotencyKey duplicado', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 2, dayIndex: 1, technique: 'tinta', tema: 'Línea y contorno',
        papel: 'bond_90', consigna: 'Dibuja tu mano.', criteriosFoco: ['trazo_linea'],
      },
    });
    await prisma.submission.create({
      data: { idempotencyKey: 'dup-key', objectKey: 'a.jpg', sessionNumber: 2, lessonId: lesson.id },
    });
    await expect(
      prisma.submission.create({
        data: { idempotencyKey: 'dup-key', objectKey: 'b.jpg', sessionNumber: 2, lessonId: lesson.id },
      })
    ).rejects.toThrow();
  });
});
