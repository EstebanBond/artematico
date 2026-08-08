import { useEffect, useRef, useState } from 'react';
import { graphqlRequest, AuthError } from '../api/graphql';
import { SUBMISSION_QUERY, SUBMIT_FOR_EVALUATION_MUTATION } from '../api/queries';
import { uploadImage } from '../api/upload';
import type { Lesson, Submission } from '../api/types';
import { MascotBadge } from '../components/MascotBadge';
import { sessionColorStyle } from '../theme/palette';

type Phase = 'capture' | 'waiting' | 'result' | 'failed';

interface SubmitProps {
  lesson: Pick<Lesson, 'id' | 'week' | 'dayIndex' | 'criteriosFoco'>;
  onNavigate: (screen: 'home') => void;
}

interface ResultFeedback {
  loQueFunciona: string;
  loQueSigue: string;
  microEjercicio: { instruccion: string; minutos: number };
}

const POLL_INTERVAL_MS = 2000;

export function Submit({ lesson, onNavigate }: SubmitProps) {
  const [phase, setPhase] = useState<Phase>('capture');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ResultFeedback | null>(null);
  const pollTimer = useRef<number | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current !== null) {
        window.clearInterval(pollTimer.current);
      }
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  function setPreview(url: string | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(selected ? URL.createObjectURL(selected) : null);
  }

  function handleRatingChange(criterio: string, nivel: number) {
    setRatings((prev) => ({ ...prev, [criterio]: nivel }));
  }

  const allCriteriaRated = lesson.criteriosFoco.every(
    (criterio) => typeof ratings[criterio] === 'number',
  );
  const canEvaluate = file !== null && allCriteriaRated && !submitting;

  async function handleEvaluate() {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const uploadResult = await uploadImage(file, lesson.id);
      const ratingsArray = lesson.criteriosFoco.map((criterio) => ({
        criterio,
        nivel: ratings[criterio],
      }));
      await graphqlRequest(SUBMIT_FOR_EVALUATION_MUTATION, {
        submissionId: uploadResult.submissionId,
        ratings: ratingsArray,
      });
      setPhase('waiting');
      startPolling(uploadResult.submissionId);
    } catch (err) {
      if (err instanceof AuthError) {
        window.location.reload();
        return;
      }
      setError(err instanceof Error ? err.message : 'No se pudo enviar el dibujo');
    } finally {
      setSubmitting(false);
    }
  }

  function startPolling(submissionId: string) {
    pollTimer.current = window.setInterval(async () => {
      try {
        const res = await graphqlRequest<{ submission: Submission | null }>(SUBMISSION_QUERY, {
          id: submissionId,
        });
        const submission = res.submission;
        if (!submission) return;
        if (submission.status === 'evaluated' && submission.evaluation) {
          stopPolling();
          setResult({
            loQueFunciona: submission.evaluation.loQueFunciona,
            loQueSigue: submission.evaluation.loQueSigue,
            microEjercicio: submission.evaluation.microEjercicio,
          });
          setPhase('result');
        } else if (submission.status === 'failed') {
          stopPolling();
          setPhase('failed');
        }
      } catch (err) {
        if (err instanceof AuthError) {
          stopPolling();
          window.location.reload();
        }
        // errores transitorios de red: seguimos intentando en el próximo tick
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function handleRetry() {
    setPhase('capture');
    setFile(null);
    setPreview(null);
    setRatings({});
    setResult(null);
    setError(null);
  }

  return (
    <div className="screen" style={sessionColorStyle(lesson.week, lesson.dayIndex)}>
      <header className="screen-header">
        <MascotBadge />
        <button type="button" className="link-button" onClick={() => onNavigate('home')}>
          ← Volver
        </button>
      </header>

      {phase === 'capture' && (
        <>
          <h1>Enviar mi dibujo</h1>
          <div className="card">
            <label htmlFor="photo-input">Toma una foto de tu dibujo</label>
            <input
              id="photo-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={handleFileChange}
            />
            {previewUrl && (
              <img className="photo-preview" src={previewUrl} alt="Vista previa de tu dibujo" />
            )}
          </div>

          {file && (
            <div className="card">
              <h2>Autoevaluación</h2>
              <p>Antes de enviar, califica cada criterio del 1 al 4.</p>
              {lesson.criteriosFoco.map((criterio) => (
                <div key={criterio} className="rating-row">
                  <span className="rating-label">{criterio}</span>
                  <div className="rating-buttons">
                    {[1, 2, 3, 4].map((nivel) => (
                      <button
                        key={nivel}
                        type="button"
                        className={ratings[criterio] === nivel ? 'rating-btn selected' : 'rating-btn'}
                        onClick={() => handleRatingChange(criterio, nivel)}
                      >
                        {nivel}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          <button type="button" disabled={!canEvaluate} onClick={handleEvaluate}>
            {submitting ? 'Enviando...' : 'Evaluar'}
          </button>
        </>
      )}

      {phase === 'waiting' && (
        <div className="card">
          <p>Evaluando tu dibujo...</p>
        </div>
      )}

      {phase === 'result' && result && (
        <div className="card">
          <h1>Tu feedback</h1>
          <section>
            <h2>Lo que funciona</h2>
            <p>{result.loQueFunciona}</p>
          </section>
          <section>
            <h2>Lo que sigue</h2>
            <p>{result.loQueSigue}</p>
          </section>
          <section>
            <h2>Micro-ejercicio</h2>
            <p>
              {result.microEjercicio.instruccion} ({result.microEjercicio.minutos} min)
            </p>
          </section>
          <button type="button" onClick={() => onNavigate('home')}>
            Volver a inicio
          </button>
        </div>
      )}

      {phase === 'failed' && (
        <div className="card">
          <p className="error-text">Algo salió mal, intenta de nuevo más tarde.</p>
          <button type="button" onClick={handleRetry}>
            Intentar de nuevo
          </button>
        </div>
      )}
    </div>
  );
}
