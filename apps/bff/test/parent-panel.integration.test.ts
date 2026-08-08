import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

let container: StartedTestContainer;
let prisma: PrismaClient;
let app: Express;
let agent: ReturnType<typeof request.agent>;

// El resolver parentPanel necesita leer content/curriculum.yaml. Apuntamos
// CONTENT_DIR a la carpeta REAL del repo (privada en producción, pero
// presente en este entorno de desarrollo/CI) y verificamos que exista antes
// de correr el bloque de compras — si no está disponible, no reventamos el
// suite completo, solo saltamos ese caso puntual con un mensaje claro.
const contentDir = path.join(__dirname, '..', '..', '..', 'content');
const curriculumPath = path.join(contentDir, 'curriculum.yaml');
const curriculumAvailable = fs.existsSync(curriculumPath);

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_DB: 'taller_test', POSTGRES_USER: 'taller', POSTGRES_PASSWORD: 'test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const databaseUrl = `postgresql://taller:test@${container.getHost()}:${container.getMappedPort(5432)}/taller_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.FAMILY_PIN = 'test-pin-0000';
  process.env.COOKIE_SECRET = 'test-cookie-secret';
  process.env.CONTENT_DIR = contentDir;

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const dbModule = await import('../src/db.js');
  prisma = dbModule.prisma;
  const appModule = await import('../src/app.js');
  app = await appModule.createApp();

  // /graphql queda detrás del gate de PIN (rebanada 10) — mismo PIN familiar
  // que todo lo demás, no hay credencial separada de padre.
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

const PARENT_PANEL_QUERY = `
  query {
    parentPanel {
      banderas { submissionId sessionNumber lessonTema texto createdAt }
      comprasPendientes { id item critical purchaseByDate semaforo notas }
    }
  }
`;

describe('GraphQL Query.parentPanel', () => {
  it('sin banderas ni evaluaciones: banderas vacío y comprasPendientes con los items de curriculum.yaml', async () => {
    if (!curriculumAvailable) {
      console.warn(
        `[skip] content/curriculum.yaml no está disponible en ${curriculumPath}; se salta la verificación de comprasPendientes.`,
      );
      return;
    }

    const res = await agent.post('/graphql').send({ query: PARENT_PANEL_QUERY });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();

    expect(res.body.data.parentPanel.banderas).toEqual([]);

    const compras = res.body.data.parentPanel.comprasPendientes as Array<{
      id: string;
      semaforo: string;
    }>;
    const ids = compras.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining(['papel_algodon', 'block_practica', 'goma_moldeable', 'acuarela_cotman']),
    );
    for (const compra of compras) {
      expect(['verde', 'amarillo', 'rojo']).toContain(compra.semaforo);
    }
  });

  it('incluye una evaluación con banderaParaPapa en banderas, con texto/lessonTema/sessionNumber correctos', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 5,
        dayIndex: 1,
        technique: 'acuarela',
        tema: 'Paisajes con agua',
        papel: 'algodon_300',
        consigna: 'Pinta un paisaje.',
        criteriosFoco: ['valor_luz_sombra'],
      },
    });

    const submission = await prisma.submission.create({
      data: {
        idempotencyKey: 'parent-panel-flag-001',
        objectKey: 'submissions/parent-panel-flag-001.jpg',
        sessionNumber: 7,
        lessonId: lesson.id,
        status: 'evaluated',
      },
    });

    await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        rubricJson: {},
        promptSha256: 'fakehash-flag',
        model: 'claude-sonnet-5',
        banderaParaPapa: 'Revisar cómo toma el lápiz',
        calidadFotoUsable: true,
      },
    });

    const res = await agent.post('/graphql').send({ query: PARENT_PANEL_QUERY });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();

    const banderas = res.body.data.parentPanel.banderas as Array<{
      submissionId: string;
      sessionNumber: number;
      lessonTema: string;
      texto: string;
    }>;
    const bandera = banderas.find((b) => b.submissionId === submission.id);
    expect(bandera).toBeDefined();
    expect(bandera?.texto).toBe('Revisar cómo toma el lápiz');
    expect(bandera?.lessonTema).toBe('Paisajes con agua');
    expect(bandera?.sessionNumber).toBe(7);
  });

  it('excluye evaluaciones con banderaParaPapa null', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 5,
        dayIndex: 2,
        technique: 'acuarela',
        tema: 'Nubes y reflejo',
        papel: 'algodon_300',
        consigna: 'Pinta nubes.',
        criteriosFoco: ['valor_luz_sombra'],
      },
    });

    const submission = await prisma.submission.create({
      data: {
        idempotencyKey: 'parent-panel-no-flag-001',
        objectKey: 'submissions/parent-panel-no-flag-001.jpg',
        sessionNumber: 8,
        lessonId: lesson.id,
        status: 'evaluated',
      },
    });

    await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        rubricJson: {},
        promptSha256: 'fakehash-noflag',
        model: 'claude-sonnet-5',
        banderaParaPapa: null,
        calidadFotoUsable: true,
      },
    });

    const res = await agent.post('/graphql').send({ query: PARENT_PANEL_QUERY });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();

    const banderas = res.body.data.parentPanel.banderas as Array<{ submissionId: string }>;
    expect(banderas.find((b) => b.submissionId === submission.id)).toBeUndefined();
  });
});
