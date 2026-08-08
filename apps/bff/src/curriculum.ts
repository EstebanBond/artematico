import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

interface CompraYaml {
  id: string;
  item: string;
  critical: boolean;
  purchase_by_day: number;
  notas?: string;
}

interface CurriculumYaml {
  meta: { start_date: string };
  compras: CompraYaml[];
}

export type Semaforo = 'verde' | 'amarillo' | 'rojo';

export interface CompraPendiente {
  id: string;
  item: string;
  critical: boolean;
  purchaseByDate: string;
  semaforo: Semaforo;
  notas: string | null;
}

function loadCurriculum(): CurriculumYaml {
  const contentDir = process.env.CONTENT_DIR ?? path.join(process.cwd(), '..', '..', 'content');
  const filePath = path.join(contentDir, 'curriculum.yaml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(raw) as CurriculumYaml;
}

function computeSemaforo(daysUntil: number): Semaforo {
  if (daysUntil <= 3) return 'rojo';
  if (daysUntil <= 10) return 'amarillo';
  return 'verde';
}

export function getComprasPendientes(now: Date = new Date()): CompraPendiente[] {
  const curriculum = loadCurriculum();
  const startDate = new Date(curriculum.meta.start_date + 'T00:00:00');

  return curriculum.compras.map((c) => {
    const purchaseByDate = new Date(startDate);
    purchaseByDate.setDate(purchaseByDate.getDate() + c.purchase_by_day);
    const daysUntil = Math.ceil((purchaseByDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return {
      id: c.id,
      item: c.item,
      critical: c.critical,
      purchaseByDate: purchaseByDate.toISOString().split('T')[0],
      semaforo: computeSemaforo(daysUntil),
      notas: c.notas ?? null,
    };
  });
}
