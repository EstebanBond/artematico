import { useEffect, useState } from 'react';
import { graphqlRequest, AuthError } from '../api/graphql';
import { TODAY_QUERY } from '../api/queries';
import type { TodayResult } from '../api/types';
import { MascotBadge } from '../components/MascotBadge';
import { sessionColorStyle } from '../theme/palette';

interface HomeProps {
  onNavigate: (screen: 'submit' | 'estudio-libre' | 'parent-panel') => void;
  onLessonLoaded: (lesson: TodayResult['lesson']) => void;
}

export function Home({ onNavigate, onLessonLoaded }: HomeProps) {
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

  const { lesson, recentSubmissions } = data;

  return (
    <div className="screen" style={sessionColorStyle(lesson.week, lesson.dayIndex)}>
      <header className="screen-header">
        <MascotBadge />
        <h1>Taller de Ilustración</h1>
      </header>
      <section className="card accent-card">
        <h2>{lesson.technique}</h2>
        <p>
          <strong>Tema:</strong> {lesson.tema}
        </p>
        <p>
          <strong>Papel:</strong> {lesson.papel}
        </p>
        <p>
          <strong>Consigna:</strong> {lesson.consigna}
        </p>
        <div>
          <strong>Criterios en foco:</strong>
          <ul>
            {lesson.criteriosFoco.map((criterio) => (
              <li key={criterio}>{criterio}</li>
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
          Enviar mi dibujo
        </button>
        <button type="button" className="secondary" onClick={() => onNavigate('estudio-libre')}>
          Estudio libre
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
    </div>
  );
}
