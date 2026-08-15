import { describe, expect, it } from 'vitest';
import { startOfMexicoCityDay } from '../src/timezone.js';

describe('startOfMexicoCityDay', () => {
  it('sigue contando como "el día anterior" pasada la medianoche UTC pero antes de medianoche CDMX', () => {
    // 2026-08-11T05:30:00Z = 2026-08-10T23:30:00 hora CDMX (UTC-6) -> todavía es 10 de agosto ahí
    const result = startOfMexicoCityDay(new Date('2026-08-11T05:30:00Z'));
    expect(result.toISOString()).toBe('2026-08-10T06:00:00.000Z');
  });

  it('calcula la medianoche CDMX del mismo día para una hora de la mañana en CDMX', () => {
    // 2026-08-11T16:00:00Z = 2026-08-11T10:00:00 hora CDMX -> es 11 de agosto ahí
    const result = startOfMexicoCityDay(new Date('2026-08-11T16:00:00Z'));
    expect(result.toISOString()).toBe('2026-08-11T06:00:00.000Z');
  });
});
