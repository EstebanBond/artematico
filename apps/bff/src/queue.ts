import { Queue } from 'bullmq';
import { createRedisConnection } from './redis.js';
import { transitionStatus } from './stateMachine.js';

export const evaluationQueue = new Queue('evaluation', {
  connection: createRedisConnection(),
});

export interface EvaluationJobData {
  submissionId: string;
}

export async function enqueueEvaluation(submissionId: string): Promise<void> {
  const transitioned = await transitionStatus(submissionId, ['uploaded'], 'queued');
  if (!transitioned) {
    throw new Error(`Submission ${submissionId} no está en estado 'uploaded', no se puede encolar`);
  }
  await evaluationQueue.add(
    'evaluate',
    { submissionId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
}
