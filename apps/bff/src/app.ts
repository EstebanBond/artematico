import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uploadRouter } from './upload.js';
import { printPackageRouter } from './printPackage.js';
import { pushRouter } from './push.js';
import { resolvers } from './resolvers.js';
import { authRouter, requireAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const typeDefs = readFileSync(path.join(__dirname, 'schema.graphql'), 'utf-8');

export async function createApp(): Promise<Express> {
  const app = express();

  // El tráfico real llega vía Traefik -> nginx (web) -> bff — sin esto,
  // express-rate-limit no confía en el X-Forwarded-For que pone Traefik y
  // termina agrupando a todos los usuarios bajo una sola IP (la del
  // contenedor `web`). Se confía en las redes privadas de Docker (por donde
  // solo puede llegar tráfico interno, nunca directo de internet), no en un
  // número fijo de saltos.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  const cookieSecret = process.env.COOKIE_SECRET;
  if (!cookieSecret) {
    throw new Error('Falta COOKIE_SECRET — requerido para firmar la cookie de sesión del PIN');
  }
  app.use(cookieParser(cookieSecret));
  // express.json() global: /auth/pin necesita parsear su body JSON. No molesta a
  // /upload (multipart, lo maneja multer) — express.json() se ignora a sí mismo
  // cuando el Content-Type no es application/json.
  app.use(express.json());

  // /health y /auth/* son públicos a propósito: los healthchecks de Docker/Traefik
  // no deben requerir PIN, y /auth/pin es justamente cómo se obtiene la sesión.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.use(authRouter);

  // /upload y /graphql quedan detrás del gate de PIN familiar (regla dura del
  // proyecto): sin cookie de sesión válida, nada de la app funciona.
  app.use(requireAuth, uploadRouter);
  app.use(requireAuth, printPackageRouter);
  app.use(requireAuth, pushRouter);

  const apolloServer = new ApolloServer({ typeDefs, resolvers });
  await apolloServer.start();

  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';
  // express.json() ya corre globalmente arriba — aplicarlo otra vez aquí leería
  // un stream de request ya consumido y pisaría req.body con uno vacío.
  app.use(
    '/graphql',
    cors({ origin: allowedOrigin, credentials: true }),
    requireAuth,
    expressMiddleware(apolloServer, {
      context: async ({ req }) => ({ studentId: req.studentId as string }),
    }),
  );

  return app;
}
