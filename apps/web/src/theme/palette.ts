import type { CSSProperties } from 'react';

// Paleta derivada del arcoíris del mascota. Cada lección (semana+día) toma un
// color distinto de esta lista — pequeño detalle para que la app se sienta viva
// sesión tras sesión, no una decisión de negocio real (no hay contrato de datos
// que dependa de esto).
export interface SessionColor {
  accent: string;
  accentSoft: string;
}

const SESSION_COLORS: SessionColor[] = [
  { accent: '#e0359a', accentSoft: '#fce7f3' }, // rosa
  { accent: '#f0740a', accentSoft: '#ffedd5' }, // naranja
  { accent: '#ca9a05', accentSoft: '#fef9c3' }, // amarillo (oscurecido para contraste con blanco)
  { accent: '#0d9488', accentSoft: '#ccfbf1' }, // turquesa
  { accent: '#2563eb', accentSoft: '#dbeafe' }, // azul
  { accent: '#7c3aed', accentSoft: '#ede9fe' }, // morado
];

export function getSessionColor(week: number, dayIndex: number): SessionColor {
  const index = (week * 10 + dayIndex) % SESSION_COLORS.length;
  return SESSION_COLORS[index];
}

// CSS custom properties listas para pasar a `style` en un contenedor de React.
export function sessionColorStyle(week: number, dayIndex: number): CSSProperties {
  const { accent, accentSoft } = getSessionColor(week, dayIndex);
  return { '--accent': accent, '--accent-soft': accentSoft } as CSSProperties;
}
