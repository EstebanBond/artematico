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
  process.env.STUDENTS = 'jorge:test-pin-0000:Jorge,georgina:other-pin:Georgina';
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

  // /graphql queda detrás del gate de PIN — el Panel de papá es una vista
  // familiar, así que basta con entrar con el PIN de cualquiera de los hijos.
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
      estudiantes { id name }
      paquetes { studentId studentName disponible }
      banderas { submissionId studentId studentName sessionNumber lessonTema texto createdAt }
      materiales { id item critical week purchaseByDate semaforo notas comprada }
    }
  }
`;

const MARCAR_MATERIAL_MUTATION = `
  mutation MarcarMaterial($id: ID!, $comprada: Boolean!) {
    marcarMaterial(id: $id, comprada: $comprada) {
      id
      comprada
    }
  }
`;

describe('GraphQL Query.parentPanel', () => {
  it('sin banderas ni evaluaciones: banderas vacío, materiales con los items sembrados, y ningún paquete disponible', async () => {
    await prisma.materialItem.create({
      data: {
        id: 'papel_algodon',
        item: 'Papel 100% algodón, 300 g/m²',
        critical: true,
        week: null,
        purchaseByDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        comprada: false,
      },
    });
    await prisma.materialItem.create({
      data: {
        id: 'w2-grafitos-hb-2b-4b',
        item: 'Grafitos HB / 2B / 4B',
        critical: true,
        week: 2,
        purchaseByDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        comprada: true,
      },
    });

    const res = await agent.post('/graphql').send({ query: PARENT_PANEL_QUERY });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();

    expect(res.body.data.parentPanel.banderas).toEqual([]);

    const estudiantes = res.body.data.parentPanel.estudiantes as Array<{ id: string; name: string }>;
    expect(estudiantes).toEqual(
      expect.arrayContaining([
        { id: 'jorge', name: 'Jorge' },
        { id: 'georgina', name: 'Georgina' },
      ]),
    );

    const paquetes = res.body.data.parentPanel.paquetes as Array<{ studentId: string; disponible: boolean }>;
    expect(paquetes).toEqual(
      expect.arrayContaining([
        { studentId: 'jorge', studentName: 'Jorge', disponible: false },
        { studentId: 'georgina', studentName: 'Georgina', disponible: false },
      ]),
    );

    const materiales = res.body.data.parentPanel.materiales as Array<{
      id: string;
      semaforo: string | null;
      comprada: boolean;
    }>;
    const ids = materiales.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['papel_algodon', 'w2-grafitos-hb-2b-4b']));

    const pendiente = materiales.find((m) => m.id === 'papel_algodon')!;
    expect(pendiente.comprada).toBe(false);
    expect(['verde', 'amarillo', 'rojo']).toContain(pendiente.semaforo);

    const comprado = materiales.find((m) => m.id === 'w2-grafitos-hb-2b-4b')!;
    expect(comprado.comprada).toBe(true);
    expect(comprado.semaforo).toBeNull();
  });

  it('Mutation.marcarMaterial togglea comprada y lo persiste', async () => {
    const res = await agent.post('/graphql').send({
      query: MARCAR_MATERIAL_MUTATION,
      variables: { id: 'papel_algodon', comprada: true },
    });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.marcarMaterial).toEqual({ id: 'papel_algodon', comprada: true });

    const stored = await prisma.materialItem.findUniqueOrThrow({ where: { id: 'papel_algodon' } });
    expect(stored.comprada).toBe(true);
  });

  it('incluye una evaluación con banderaParaPapa en banderas, con estudiante/texto/lessonTema/sessionNumber correctos', async () => {
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
        studentId: 'jorge',
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

    // Ya existe una submission 'evaluated' de Jorge (creada arriba) — su
    // paquete de impresión debe pasar a estar disponible; el de Georgina no.
    const paquetes = res.body.data.parentPanel.paquetes as Array<{ studentId: string; disponible: boolean }>;
    expect(paquetes.find((p) => p.studentId === 'jorge')?.disponible).toBe(true);
    expect(paquetes.find((p) => p.studentId === 'georgina')?.disponible).toBe(false);

    const banderas = res.body.data.parentPanel.banderas as Array<{
      submissionId: string;
      studentId: string;
      studentName: string;
      sessionNumber: number;
      lessonTema: string;
      texto: string;
    }>;
    const bandera = banderas.find((b) => b.submissionId === submission.id);
    expect(bandera).toBeDefined();
    expect(bandera?.studentId).toBe('jorge');
    expect(bandera?.studentName).toBe('Jorge');
    expect(bandera?.texto).toBe('Revisar cómo toma el lápiz');
    expect(bandera?.lessonTema).toBe('Paisajes con agua');
    expect(bandera?.sessionNumber).toBe(7);
  });

  it('banderas de dos estudiantes distintos traen cada una el studentName correcto', async () => {
    const lesson = await prisma.lesson.create({
      data: {
        week: 6,
        dayIndex: 1,
        technique: 'linea_tecnica',
        tema: 'Perspectiva',
        papel: 'opalina',
        consigna: 'Dibuja un pasillo.',
        criteriosFoco: ['espacio_perspectiva'],
      },
    });

    const submission = await prisma.submission.create({
      data: {
        idempotencyKey: 'parent-panel-flag-georgina-001',
        objectKey: 'submissions/parent-panel-flag-georgina-001.jpg',
        studentId: 'georgina',
        sessionNumber: 1,
        lessonId: lesson.id,
        status: 'evaluated',
      },
    });

    await prisma.evaluation.create({
      data: {
        submissionId: submission.id,
        rubricJson: {},
        promptSha256: 'fakehash-flag-georgina',
        model: 'claude-sonnet-5',
        banderaParaPapa: 'Revisar cómo sostiene la regla',
        calidadFotoUsable: true,
      },
    });

    const res = await agent.post('/graphql').send({ query: PARENT_PANEL_QUERY });

    const banderas = res.body.data.parentPanel.banderas as Array<{
      submissionId: string;
      studentId: string;
      studentName: string;
    }>;
    const banderaJorge = banderas.find((b) => b.studentId === 'jorge');
    const banderaGeorgina = banderas.find((b) => b.submissionId === submission.id);
    expect(banderaJorge?.studentName).toBe('Jorge');
    expect(banderaGeorgina?.studentName).toBe('Georgina');
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
        studentId: 'jorge',
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
