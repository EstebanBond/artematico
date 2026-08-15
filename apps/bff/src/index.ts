import { createApp } from './app.js';
import { startEvaluationWorker } from './worker.js';
import { startReminderWorker } from './reminderWorker.js';
import { registerReminderSchedules } from './reminderQueue.js';

const PORT = 4000;

createApp().then((app) => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BFF server running on http://0.0.0.0:${PORT}`);
  });
});

startEvaluationWorker();
startReminderWorker();
registerReminderSchedules().catch((err) => {
  console.error('Error registrando el horario de recordatorios:', err);
});
