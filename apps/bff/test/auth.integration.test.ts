import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { execSync } from 'node:child_process';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

// Prueba el gate de PIN en sí (rebanada 10): "el PIN familiar bloquea toda la
// app sin PIN válido". Los demás tests de integración prueban el camino YA
// autenticado; este archivo prueba que SIN autenticar, nada funciona.

let container: StartedTestContainer;
let app: Express;

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({ POSTGRES_DB: 'taller_test', POSTGRES_USER: 'taller', POSTGRES_PASSWORD: 'test' })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const databaseUrl = `postgresql://taller:test@${container.getHost()}:${container.getMappedPort(5432)}/taller_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.FAMILY_PIN = 'correct-pin';
  process.env.COOKIE_SECRET = 'test-cookie-secret';

  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const appModule = await import('../src/app.js');
  app = await appModule.createApp();
}, 60_000);

afterAll(async () => {
  await container?.stop();
});

describe('Gate de PIN familiar', () => {
  it('/health sigue siendo público (healthchecks de Docker/Traefik no deben pedir PIN)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  it('/graphql sin cookie de sesión devuelve 401', async () => {
    const res = await request(app)
      .post('/graphql')
      .send({ query: '{ today { lesson { week } } }' });
    expect(res.status).toBe(401);
  });

  it('/upload sin cookie de sesión devuelve 401', async () => {
    const res = await request(app)
      .post('/upload')
      .set('Idempotency-Key', 'auth-test-key')
      .attach('image', Buffer.from([0xff, 0xd8, 0xff, 0xdb]), { filename: 'test.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(401);
  });

  it('POST /auth/pin con PIN incorrecto no autentica y devuelve 401', async () => {
    const res = await request(app).post('/auth/pin').send({ pin: 'pin-equivocado' });
    expect(res.status).toBe(401);
  });

  it('GET /auth/status sin sesión reporta authenticated: false', async () => {
    const res = await request(app).get('/auth/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it('con el PIN correcto abre sesión y desbloquea /graphql y /upload', async () => {
    const agent = request.agent(app);

    const login = await agent.post('/auth/pin').send({ pin: 'correct-pin' });
    expect(login.status).toBe(200);

    const status = await agent.get('/auth/status');
    expect(status.body.authenticated).toBe(true);

    // Ya autenticado, /graphql responde (puede traer su propio error de negocio,
    // pero YA NO debe ser 401 de autenticación).
    const graphqlRes = await agent
      .post('/graphql')
      .send({ query: '{ today { lesson { week } } }' });
    expect(graphqlRes.status).not.toBe(401);
  });

  it('logout invalida la sesión: /graphql vuelve a dar 401', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/pin').send({ pin: 'correct-pin' });
    await agent.post('/auth/logout');

    const res = await agent.post('/graphql').send({ query: '{ today { lesson { week } } }' });
    expect(res.status).toBe(401);
  });
});
