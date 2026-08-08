import { createApp } from './app.js';
import { startEvaluationWorker } from './worker.js';

const PORT = 4000;

createApp().then((app) => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BFF server running on http://0.0.0.0:${PORT}`);
  });
});

startEvaluationWorker();
