// Convierte la llave pública VAPID (base64url, como la manda el servidor) al
// Uint8Array que pide PushManager.subscribe().
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function subscribeToReminders(): Promise<void> {
  if (!pushSupported()) {
    throw new Error('Este navegador no soporta notificaciones push');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('No diste permiso de notificaciones');
  }

  const registration = await navigator.serviceWorker.ready;

  const keyRes = await fetch('/push/vapid-public-key', { credentials: 'include' });
  if (!keyRes.ok) {
    throw new Error('No se pudo obtener la llave del servidor');
  }
  const { publicKey } = (await keyRes.json()) as { publicKey: string };

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    // Cast: TS tipa Uint8Array<ArrayBufferLike> pero pushManager.subscribe
    // pide BufferSource — el valor en runtime es válido, es solo un choque
    // de tipos de lib.dom.d.ts.
    applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
  });

  const subRes = await fetch('/push/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!subRes.ok) {
    throw new Error('No se pudo guardar la suscripción en el servidor');
  }
}
