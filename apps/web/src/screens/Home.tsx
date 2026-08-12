import { useEffect, useState } from 'react';
import { graphqlRequest, AuthError } from '../api/graphql';
import { TODAY_QUERY } from '../api/queries';
import type { TodayResult } from '../api/types';
import { MascotBadge } from '../components/MascotBadge';
import { sessionColorStyle } from '../theme/palette';
import { friendlyTechnique, friendlyPapel, friendlyCriterio } from '../content/friendlyLabels';
import { useStudent } from '../auth/StudentContext';

interface HomeProps {
  onNavigate: (screen: 'submit' | 'estudio-libre' | 'parent-panel') => void;
  onLessonLoaded: (lesson: TodayResult['lesson']) => void;
}

export function Home({ onNavigate, onLessonLoaded }: HomeProps) {
  const { studentName } = useStudent();
  const [data, setData] = useState<TodayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    graphqlRequest<{ today: TodayResult }>(TODAY_QUERY)
      .then((result) => {
        if (cancelled) return;
        setData(result.today);
        onLessonLoaded(result.today.lesson);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof AuthError) {
          // Sesión perdida o expirada: recargar para volver a mostrar el gate de PIN.
          window.location.reload();
          return;
        }
        setError(err instanceof Error ? err.message : 'Ocurrió un error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onLessonLoaded]);

  if (loading) {
    return (
      <div className="screen">
        <p>Cargando lección de hoy...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  async function handleLogout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.reload();
  }

  const { lesson, recentSubmissions } = data;

  return (
    <div className="screen" style={sessionColorStyle(lesson.week, lesson.dayIndex)}>
      <header className="screen-header">
        <MascotBadge />
        <div>
          <h1>Taller de Ilustración</h1>
          <p className="greeting">¡Hola, {studentName}!</p>
        </div>
      </header>
      <section className="card accent-card">
        <h2>{friendlyTechnique(lesson.technique)}</h2>
        <p>
          <strong>Tema:</strong> {lesson.tema}
        </p>
        <p>
          <strong>Papel:</strong> {friendlyPapel(lesson.papel)}
        </p>
        {lesson.materialesExtra.length > 0 && (
          <div>
            <strong>Qué más vas a necesitar:</strong>
            <ul>
              {lesson.materialesExtra.map((material) => (
                <li key={material}>{material}</li>
              ))}
            </ul>
          </div>
        )}
        <p>
          <strong>Objetivo de la lección:</strong> {lesson.consigna}
        </p>
        <div>
          <strong>Criterios para observar avance:</strong>
          <ul>
            {lesson.criteriosFoco.map((criterio) => (
              <li key={criterio}>{friendlyCriterio(criterio)}</li>
            ))}
          </ul>
        </div>
        {lesson.videoUrl && (
          <p>
            <a href={lesson.videoUrl} target="_blank" rel="noreferrer">
              Ver video de la lección
            </a>
          </p>
        )}
      </section>

      <div className="button-row">
        <button type="button" onClick={() => onNavigate('submit')}>
          1. Enviar mi dibujo
        </button>
        <button type="button" className="secondary" onClick={() => onNavigate('estudio-libre')}>
          2. Estudio libre
        </button>
      </div>

      {recentSubmissions.length > 0 && (
        <section className="card">
          <h3>Envíos recientes</h3>
          <ul>
            {recentSubmissions.map((submission) => (
              <li key={submission.id}>
                Sesión {submission.sessionNumber} — {submission.status}
              </li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" className="link-button" onClick={() => onNavigate('parent-panel')}>
        Panel de papá
      </button>
      <button type="button" className="link-button" onClick={handleLogout}>
        Cerrar sesión {studentName} (para que otro hermano entre con su PIN)
      </button>
    </div>
  );
}
