import { useEffect, useState } from 'react';
import { graphqlRequest, AuthError } from '../api/graphql';
import { PARENT_PANEL_QUERY, MARCAR_MATERIAL_MUTATION } from '../api/queries';
import type { ParentPanelData, MaterialItem, Semaforo } from '../api/types';
import { MascotBadge } from '../components/MascotBadge';

interface ParentPanelProps {
  onNavigate: (screen: 'home') => void;
}

const SEMAFORO_CLASS: Record<Semaforo, string> = {
  rojo: 'semaforo-rojo',
  amarillo: 'semaforo-amarillo',
  verde: 'semaforo-verde',
};

function groupByWeek(materiales: MaterialItem[]): Array<[number | null, MaterialItem[]]> {
  const groups = new Map<number | null, MaterialItem[]>();
  for (const material of materiales) {
    const key = material.week;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(material);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === null) return -1;
    if (b[0] === null) return 1;
    return a[0] - b[0];
  });
}

export function ParentPanel({ onNavigate }: ParentPanelProps) {
  const [data, setData] = useState<ParentPanelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

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

  async function handleToggle(id: string, comprada: boolean) {
    if (!data) return;
    setToggleError(null);
    const previous = data.materiales;
    setData({
      ...data,
      materiales: data.materiales.map((m) =>
        m.id === id ? { ...m, comprada, semaforo: comprada ? null : m.semaforo } : m,
      ),
    });
    try {
      await graphqlRequest(MARCAR_MATERIAL_MUTATION, { id, comprada });
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        window.location.reload();
        return;
      }
      setData({ ...data, materiales: previous });
      setToggleError(err instanceof Error ? err.message : 'No se pudo guardar el cambio');
    }
  }

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

  const { banderas, materiales, paquetes } = data;
  const pendientes = materiales.filter((m) => !m.comprada);
  const pendientesCriticos = pendientes.filter((m) => m.critical);

  return (
    <div className="screen">
      <header className="screen-header">
        <MascotBadge />
        <h1>Panel de papá</h1>
      </header>
      <button type="button" className="link-button" onClick={() => onNavigate('home')}>
        ← Volver
      </button>

      <section className="card">
        <h2>Paquete de impresión</h2>
        <ul>
          {paquetes.map((paquete) => (
            <li key={paquete.studentId}>
              {paquete.disponible ? (
                <a className="link-button" href={`/print-package?studentId=${paquete.studentId}`} download>
                  Descargar paquete de {paquete.studentName} (PDF)
                </a>
              ) : (
                <p className="muted-text">
                  {paquete.studentName} todavía no tiene sesiones evaluadas — su paquete estará
                  disponible en cuanto tenga al menos una.
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Banderas</h2>
        {banderas.length === 0 ? (
          <p>Sin banderas pendientes.</p>
        ) : (
          <ul>
            {banderas.map((bandera) => (
              <li key={bandera.submissionId}>
                <strong>{bandera.studentName}</strong> — Sesión {bandera.sessionNumber} — {bandera.lessonTema}
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
        {pendientesCriticos.length > 0 ? (
          <p className="alert alert-critical">
            Faltan {pendientesCriticos.length} material{pendientesCriticos.length === 1 ? '' : 'es'} crítico
            {pendientesCriticos.length === 1 ? '' : 's'} por comprar.
          </p>
        ) : pendientes.length > 0 ? (
          <p className="alert alert-info">
            Faltan {pendientes.length} material{pendientes.length === 1 ? '' : 'es'} por comprar (no urgentes).
          </p>
        ) : (
          <p className="alert alert-ok">Ya tienes todo el material.</p>
        )}
        {toggleError && <p className="error-text">{toggleError}</p>}

        {groupByWeek(materiales).map(([week, items]) => (
          <div key={week ?? 'compras'}>
            <h3>{week === null ? 'Para comprar' : `Semana ${week}`}</h3>
            <ul>
              {items.map((material) => (
                <li key={material.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={material.comprada}
                      onChange={(e) => handleToggle(material.id, e.target.checked)}
                    />
                    {material.semaforo && (
                      <span className={`semaforo-dot ${SEMAFORO_CLASS[material.semaforo]}`} aria-hidden="true" />
                    )}
                    {material.item}
                    {material.critical && ' (crítico)'}
                    {material.purchaseByDate && ` — límite: ${material.purchaseByDate}`}
                  </label>
                  {material.notas && (
                    <>
                      <br />
                      <small>{material.notas}</small>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
