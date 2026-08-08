import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';

// Acceso por PIN familiar compartido, no por cuenta individual (regla dura del
// proyecto, CLAUDE.md). Ni Jorge ni su papá capturan nombre, correo ni
// contraseña personal — un solo PIN vive en env var, nunca en el repo.
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
  const expectedPin = process.env.FAMILY_PIN;
  if (!expectedPin) {
    res.status(500).json({ error: 'FAMILY_PIN no configurado en el servidor' });
    return;
  }

  const { pin } = req.body as { pin?: unknown };
  if (typeof pin !== 'string' || pin !== expectedPin) {
    res.status(401).json({ error: 'PIN incorrecto' });
    return;
  }

  res.cookie(COOKIE_NAME, 'ok', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: THIRTY_DAYS_MS,
    signed: true,
  });
  res.status(200).json({ ok: true });
});

authRouter.get('/auth/status', (req: Request, res: Response) => {
  res.status(200).json({ authenticated: isAuthenticated(req) });
});

authRouter.post('/auth/logout', (req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME);
  res.status(200).json({ ok: true });
});

function isAuthenticated(req: Request): boolean {
  return req.signedCookies?.[COOKIE_NAME] === 'ok';
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }
  next();
}
