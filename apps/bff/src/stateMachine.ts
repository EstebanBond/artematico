import { prisma } from './db.js';
import type { SubmissionStatus } from '@prisma/client';

// Transición atómica: solo cambia el estado si el Submission está actualmente
// en uno de los estados de `from`. Si otro proceso ya lo cambió (o nunca estuvo
// en ese estado), no hace nada y devuelve false — evita condiciones de carrera
// entre workers concurrentes o reintentos.
export async function transitionStatus(
  submissionId: string,
  from: SubmissionStatus[],
  to: SubmissionStatus,
): Promise<boolean> {
  const result = await prisma.submission.updateMany({
    where: { id: submissionId, status: { in: from } },
    data: { status: to },
  });
  return result.count > 0;
}
