// Ciudad de México dejó el horario de verano en 2022 — UTC-6 fijo todo el
// año. Un offset constante alcanza; no hace falta una librería de fechas
// para una sola zona horaria fija.
const MEXICO_CITY_OFFSET_HOURS = 6;

export function startOfMexicoCityDay(date: Date = new Date()): Date {
  const shifted = new Date(date.getTime() - MEXICO_CITY_OFFSET_HOURS * 60 * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + MEXICO_CITY_OFFSET_HOURS * 60 * 60 * 1000);
}
