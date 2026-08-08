import { useEffect, useRef, useState } from 'react';
import { MascotBadge } from '../components/MascotBadge';

const TOTAL_SECONDS = 25 * 60;

interface EstudioLibreProps {
  onNavigate: (screen: 'home') => void;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function EstudioLibre({ onNavigate }: EstudioLibreProps) {
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current);
      }
    };
  }, []);

  function start() {
    if (running || secondsLeft === 0) return;
    setRunning(true);
    timer.current = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (timer.current !== null) {
            window.clearInterval(timer.current);
            timer.current = null;
          }
          setRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  function pause() {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
    setRunning(false);
  }

  function reset() {
    pause();
    setSecondsLeft(TOTAL_SECONDS);
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <MascotBadge />
        <button type="button" className="link-button" onClick={() => onNavigate('home')}>
          ← Volver
        </button>
      </header>
      <h1>Estudio libre</h1>
      <p>Este bloque es libre — dibuja lo que quieras. No se fotografía ni se califica.</p>
      <div className="card timer-card">
        <p className="timer-display">{formatTime(secondsLeft)}</p>
        <div className="button-row">
          <button type="button" onClick={start} disabled={running}>
            Iniciar
          </button>
          <button type="button" className="secondary" onClick={pause} disabled={!running}>
            Pausar
          </button>
          <button type="button" className="secondary" onClick={reset}>
            Reiniciar
          </button>
        </div>
      </div>
    </div>
  );
}
