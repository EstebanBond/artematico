import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import mascotFull from '../assets/mascot-full.png';
import { StudentProvider, type StudentInfo } from './StudentContext';

type GateStatus = 'checking' | 'unauthenticated' | 'authenticated';

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<GateStatus>('checking');
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/auth/status', { credentials: 'include' })
      .then((res) => res.json())
      .then((body: { authenticated: boolean; studentId?: string; studentName?: string }) => {
        if (cancelled) return;
        if (body.authenticated && body.studentId && body.studentName) {
          setStudent({ studentId: body.studentId, studentName: body.studentName });
          setStatus('authenticated');
        } else {
          setStatus('unauthenticated');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/auth/pin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        const body: { studentId: string; studentName: string } = await res.json();
        setStudent({ studentId: body.studentId, studentName: body.studentName });
        setStatus('authenticated');
        setPin('');
      } else {
        setError('PIN incorrecto');
      }
    } catch {
      setError('No se pudo conectar. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'checking') {
    return (
      <div className="gate-screen">
        <p>Cargando...</p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="gate-screen">
        <div className="gate-content">
          <img className="gate-mascot" src={mascotFull} alt="Un robot amigable pintando un arcoíris con un pincel" />
          <form className="pin-form" onSubmit={handleSubmit}>
            <h1>Taller de Ilustración</h1>
            <label htmlFor="pin-input">Tu PIN</label>
            <input
              id="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
            <button type="submit" disabled={submitting || pin.length === 0}>
              Entrar
            </button>
            {error && <p className="error-text">{error}</p>}
          </form>
        </div>
      </div>
    );
  }

  return <StudentProvider value={student}>{children}</StudentProvider>;
}
