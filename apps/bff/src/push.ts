import { Router, type Router as ExpressRouter } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from './db.js';

export const pushRouter: ExpressRouter = Router();

// Únicos hosts de servicio de push que existen de verdad (Chrome/Edge/Android,
// Firefox, Safari/iOS). El body de /push/subscribe lo manda el navegador, pero
// el servidor le hace requests salientes a ese endpoint todos los días (el
// job de recordatorios) — sin esta lista blanca, un PIN válido podría apuntar
// el endpoint a una URL interna y convertir al bff en un proxy hacia la red
// del droplet (SSRF). No es solo teórico: esto queda instalado en el celular
// de cada hijo, hay que tratarlo como superficie real.
const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

function isValidPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && ALLOWED_PUSH_HOSTS.has(url.hostname);
}

const subscribeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

// No es secreta — el navegador la necesita para pushManager.subscribe().
// La llave que sí es secreta (VAPID_PRIVATE_KEY) nunca sale de reminderWorker.ts.
pushRouter.get('/push/vapid-public-key', (_req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    res.status(500).json({ error: 'VAPID_PUBLIC_KEY no configurado en el servidor' });
    return;
  }
  res.status(200).json({ publicKey });
});

pushRouter.post('/push/subscribe', subscribeRateLimit, async (req, res) => {
  const { endpoint, keys } = req.body as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (
    typeof endpoint !== 'string' ||
    typeof keys?.p256dh !== 'string' ||
    typeof keys?.auth !== 'string' ||
    !isValidPushEndpoint(endpoint)
  ) {
    res.status(400).json({ error: 'Suscripción de push inválida' });
    return;
  }

  // studentId sale de la sesión autenticada, nunca del body — mismo patrón
  // de seguridad que upload.ts (nadie activa recordatorios a nombre de otro).
  const studentId = req.studentId as string;

  try {
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { studentId, p256dh: keys.p256dh, auth: keys.auth },
      create: { studentId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Error guardando suscripción de push:', e);
    res.status(500).json({ error: 'No se pudo guardar la suscripción' });
  }
});
