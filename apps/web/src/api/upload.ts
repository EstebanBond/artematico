export interface UploadResult {
  submissionId: string;
  objectKey: string;
  status: string;
  idempotent: boolean;
}

export async function uploadImage(file: Blob, lessonId: string): Promise<UploadResult> {
  const form = new FormData();
  form.append('image', file, 'foto.jpg');
  form.append('lessonId', lessonId);

  const res = await fetch('/upload', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: form,
  });

  if (res.status === 401) {
    throw new Error('No autenticado');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `No se pudo subir la foto (${res.status})`);
  }
  return res.json();
}
