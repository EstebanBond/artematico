import { Router, type Router as ExpressRouter } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { Prisma } from '@prisma/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db.js';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_BYTES = 12 * 1024 * 1024; // 12 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

export const uploadRouter: ExpressRouter = Router();

uploadRouter.post('/upload', uploadRateLimit, (req, res) => {
  upload.single('image')(req, res, async (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Error al procesar el archivo';
      res.status(400).json({ error: message });
      return;
    }

    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Falta el header Idempotency-Key' });
      return;
    }
    // idempotencyKey se usa para construir una ruta de archivo abajo — sin esta
    // validación, un header como "../../etc/cron.d/x" permitiría escribir fuera
    // de UPLOAD_DIR (path traversal). Solo caracteres seguros para nombre de archivo.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
      res.status(400).json({ error: 'Idempotency-Key inválida' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Falta el archivo image' });
      return;
    }

    const { lessonId } = req.body as { lessonId?: string };
    if (!lessonId) {
      res.status(400).json({ error: 'Falta lessonId' });
      return;
    }

    // sessionNumber lo calcula el servidor, no lo manda el cliente: es un
    // contador global de sesiones (1, 2, 3... a lo largo de las 40 del curso) y
    // el PWA no tiene forma de saber cuántas van sin duplicar lógica de negocio.
    const sessionNumberInt = (await prisma.submission.count()) + 1;

    // objectKey determinístico a partir de la idempotency key: si dos requests
    // concurrentes con la MISMA key llegan a escribir el archivo, escriben al
    // mismo path con el mismo contenido (mismo doble-tap) — no hay corrupción.
    // La garantía real de "un solo registro" la da el unique constraint de la DB.
    const objectKey = `submissions/${idempotencyKey}.jpg`;
    const uploadDir = process.env.UPLOAD_DIR ?? '/uploads';
    const fullPath = path.join(uploadDir, objectKey);

    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, req.file.buffer);

      const submission = await prisma.submission.create({
        data: {
          idempotencyKey,
          objectKey,
          sessionNumber: sessionNumberInt,
          lessonId,
        },
      });

      res.status(201).json({
        submissionId: submission.id,
        objectKey: submission.objectKey,
        status: submission.status,
        idempotent: false,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          // Replay idempotente: ya existe un Submission con esta idempotencyKey.
          // NO es un error — se devuelve el registro existente, no se crea uno nuevo.
          const existing = await prisma.submission.findUniqueOrThrow({
            where: { idempotencyKey },
          });
          res.status(200).json({
            submissionId: existing.id,
            objectKey: existing.objectKey,
            status: existing.status,
            idempotent: true,
          });
          return;
        }
        if (e.code === 'P2003') {
          res.status(400).json({ error: `lessonId inválido: ${lessonId}` });
          return;
        }
      }
      // No relanzar: esto corre dentro del callback de multer, fuera de la cadena
      // de middlewares de Express — un throw aquí se vuelve una promesa rechazada
      // que Express 4 no captura (no hay next(e) automático), y la request se
      // queda colgada en vez de recibir una respuesta.
      console.error('Error inesperado en /upload:', e);
      res.status(500).json({ error: 'Error interno al procesar la subida' });
    }
  });
});
