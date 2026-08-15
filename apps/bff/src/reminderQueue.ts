import { Queue } from 'bullmq';
import { createRedisConnection } from './redis.js';

export const reminderQueue = new Queue('daily-reminder', {
  connection: createRedisConnection(),
});

// Corte entre las dos fases del horario: medianoche del 31 de agosto de 2026
// en hora de Ciudad de México (UTC-6 fijo -> 06:00 UTC).
const PHASE_CUTOVER = new Date('2026-08-31T06:00:00Z');

// Registrar un repeatable job con las mismas opciones es idempotente en
// BullMQ — seguro de llamar en cada arranque del proceso, no duplica.
export async function registerReminderSchedules(): Promise<void> {
  // Fase 1: lunes a sábado, 10am, hasta el 30 de agosto (inclusive).
  await reminderQueue.add(
    'check-progress',
    {},
    {
      repeat: {
        pattern: '0 10 * * 1-6',
        tz: 'America/Mexico_City',
        endDate: PHASE_CUTOVER,
      },
    },
  );

  // Fase 2: lunes a viernes, 5pm, desde el 31 de agosto en adelante.
  await reminderQueue.add(
    'check-progress',
    {},
    {
      repeat: {
        pattern: '0 17 * * 1-5',
        tz: 'America/Mexico_City',
        startDate: PHASE_CUTOVER,
      },
    },
  );
}
