import { Worker } from 'bullmq';
import webpush from 'web-push';
import { createRedisConnection } from './redis.js';
import { prisma } from './db.js';
import { getStudents } from './students.js';
import { startOfMexicoCityDay } from './timezone.js';

let vapidConfigured = false;
function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error('Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT');
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export async function processReminderJob(): Promise<void> {
  ensureVapidConfigured();

  const startOfToday = startOfMexicoCityDay();

  for (const student of getStudents()) {
    const countToday = await prisma.submission.count({
      where: { studentId: student.id, createdAt: { gte: startOfToday } },
    });
    if (countToday > 0) continue; // ya hubo avance hoy, no molestar

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { studentId: student.id },
    });

    const payload = JSON.stringify({
      title: 'Taller de Ilustración',
      body: `¡Hola ${student.name}! Todavía no subes tu dibujo de hoy 🎨`,
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Suscripción vencida/revocada (el navegador o iOS la invalidó) —
          // se limpia en vez de seguirle intentando para siempre.
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error(`Error mandando push a ${student.id}:`, err);
        }
      }
    }
  }
}

export function startReminderWorker(): Worker {
  const connection = createRedisConnection();
  return new Worker('daily-reminder', () => processReminderJob(), {
    connection,
    concurrency: 1,
  });
}
