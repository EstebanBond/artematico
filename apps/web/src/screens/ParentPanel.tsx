import { useEffect, useState } from 'react';
import { graphqlRequest, AuthError } from '../api/graphql';
import { PARENT_PANEL_QUERY } from '../api/queries';
import type { ParentPanelData, Semaforo } from '../api/types';
import { MascotBadge } from '../components/MascotBadge';

interface ParentPanelProps {
  onNavigate: (screen: 'home') => void;
}

const SEMAFORO_CLASS: Record<Semaforo, string> = {
  rojo: 'semaforo-rojo',
  amarillo: 'semaforo-amarillo',
  verde: 'semaforo-verde',
};

export function ParentPanel({ onNavigate }: ParentPanelProps) {
  const [data, setData] = useState<ParentPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    graphqlRequest<{ parentPanel: ParentPanelData }>(PARENT_PANEL_QUERY)
      .then((result) => {
        if (cancelled) return;
        setData(result.parentPanel);
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
  }, []);

  if (loading) {
    return (
      <div className="screen">
        <p>Cargando panel de papá...</p>
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

  const { banderas, comprasPendientes } = data;

  return (
    <div className="screen">
      <header className="screen-header">
        <MascotBadge />
        <h1>Panel de papá</h1>
      </header>
      <button type="button" className="link-button" onClick={() => onNavigate('home')}>
        ← Volver
      </button>

      <a className="link-button" href="/print-package" download>
        Descargar paquete de impresión (PDF)
      </a>

      <section className="card">
        <h2>Banderas</h2>
        {banderas.length === 0 ? (
          <p>Sin banderas pendientes.</p>
        ) : (
          <ul>
            {banderas.map((bandera) => (
              <li key={bandera.submissionId}>
                Sesión {bandera.sessionNumber} — {bandera.lessonTema}
                <br />
                {bandera.texto}
                <br />
                <small>{new Date(bandera.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Compras pendientes</h2>
        <ul>
          {comprasPendientes.map((compra) => (
            <li key={compra.id}>
              <span className={`semaforo-dot ${SEMAFORO_CLASS[compra.semaforo]}`} aria-hidden="true" />
              {compra.item}
              {compra.critical && ' (crítico)'} — límite: {compra.purchaseByDate}
              {compra.notas && (
                <>
                  <br />
                  <small>{compra.notas}</small>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
