import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { findByPin, findById } from './students.js';

// Acceso por PIN — uno por hijo, no por cuenta individual (regla dura del
// proyecto, CLAUDE.md). Nadie captura nombre, correo ni contraseña personal —
// los PINs viven en la variable de entorno STUDENTS, nunca en el repo.
const COOKIE_NAME = 'taller_session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const pinRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter: ExpressRouter = Router();

authRouter.post('/auth/pin', pinRateLimit, (req: Request, res: Response) => {
  const { pin } = req.body as { pin?: unknown };
  if (typeof pin !== 'string') {
    res.status(401).json({ error: 'PIN incorrecto' });
    return;
  }

  const student = findByPin(pin);
  if (!student) {
    res.status(401).json({ error: 'PIN incorrecto' });
    return;
  }

  res.cookie(COOKIE_NAME, student.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: THIRTY_DAYS_MS,
    signed: true,
  });
  res.status(200).json({ ok: true, studentId: student.id, studentName: student.name });
});

authRouter.get('/auth/status', (req: Request, res: Response) => {
  const studentId = getStudentIdFromCookie(req);
  const student = studentId ? findById(studentId) : undefined;
  if (!student) {
    res.status(200).json({ authenticated: false });
    return;
  }
  res.status(200).json({ authenticated: true, studentId: student.id, studentName: student.name });
});

authRouter.post('/auth/logout', (req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME);
  res.status(200).json({ ok: true });
});

function getStudentIdFromCookie(req: Request): string | undefined {
  const studentId = req.signedCookies?.[COOKIE_NAME];
  return typeof studentId === 'string' ? studentId : undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const studentId = getStudentIdFromCookie(req);
  const student = studentId ? findById(studentId) : undefined;
  if (!student) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  req.studentId = student.id;
  next();
}
