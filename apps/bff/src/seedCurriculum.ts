import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { prisma } from './db.js';

interface DayYaml {
  day: string;
  leccion: string;
  proyecto: string;
}

interface FallbackYaml {
  disable_criteria?: string[];
}

interface MaterialYaml {
  item: string;
  have?: boolean;
  critical?: boolean;
  ref?: string;
  purchase_by_day?: number;
}

interface WeekYaml {
  week: number;
  technique: string;
  tema: string;
  papel: string | string[];
  criterios_foco: string[];
  fallback?: FallbackYaml;
  materials?: MaterialYaml[];
  days: DayYaml[];
}

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
  weeks: WeekYaml[];
}

function loadCurriculum(): CurriculumYaml {
  const contentDir = process.env.CONTENT_DIR ?? path.join(process.cwd(), '..', '..', 'content');
  const filePath = path.join(contentDir, 'curriculum.yaml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(raw) as CurriculumYaml;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

async function seedLecciones(curriculum: CurriculumYaml): Promise<number> {
  let count = 0;
  for (const week of curriculum.weeks) {
    const papel = Array.isArray(week.papel) ? week.papel.join(', ') : week.papel;
    const fallbackDisableCriteria = week.fallback?.disable_criteria ?? [];
    const materialesExtra = week.materials?.map((m) => m.item) ?? [];

    for (const [dayIndex, day] of week.days.entries()) {
      await prisma.lesson.upsert({
        where: { week_dayIndex: { week: week.week, dayIndex } },
        update: {
          technique: week.technique,
          tema: week.tema,
          papel,
          consigna: `${day.leccion}\n\nProyecto: ${day.proyecto}`,
          criteriosFoco: week.criterios_foco,
          fallbackDisableCriteria,
          materialesExtra,
        },
        create: {
          week: week.week,
          dayIndex,
          technique: week.technique,
          tema: week.tema,
          papel,
          consigna: `${day.leccion}\n\nProyecto: ${day.proyecto}`,
          criteriosFoco: week.criterios_foco,
          fallbackDisableCriteria,
          materialesExtra,
        },
      });
      count++;
    }
  }
  return count;
}

// `comprada` NUNCA se toca en `update`: es el único campo que la familia
// controla desde la UI (checkbox del panel de papá). Todo lo demás viene de
// content/curriculum.yaml y sí se refresca en cada seed.
async function seedMateriales(curriculum: CurriculumYaml): Promise<number> {
  const startDate = new Date(curriculum.meta.start_date + 'T00:00:00');
  let count = 0;

  for (const compra of curriculum.compras) {
    const purchaseByDate = addDays(startDate, compra.purchase_by_day);
    await prisma.materialItem.upsert({
      where: { id: compra.id },
      update: {
        item: compra.item,
        critical: compra.critical,
        week: null,
        purchaseByDate,
        notas: compra.notas ?? null,
      },
      create: {
        id: compra.id,
        item: compra.item,
        critical: compra.critical,
        week: null,
        purchaseByDate,
        notas: compra.notas ?? null,
        comprada: false,
      },
    });
    count++;
  }

  const compraIds = new Set(curriculum.compras.map((c) => c.id));

  for (const week of curriculum.weeks) {
    const weekStart = addDays(startDate, (week.week - 1) * 7);

    for (const material of week.materials ?? []) {
      // Ya cubierto por el item de compras: al que este material apunta
      // (ej. semana 5 -> papel_algodon) — evita mostrarlo duplicado.
      if (material.ref && compraIds.has(material.ref)) continue;

      const id = `w${week.week}-${slugify(material.item)}`;
      const purchaseByDate =
        material.purchase_by_day != null ? addDays(startDate, material.purchase_by_day) : weekStart;

      await prisma.materialItem.upsert({
        where: { id },
        update: {
          item: material.item,
          critical: material.critical ?? false,
          week: week.week,
          purchaseByDate,
        },
        create: {
          id,
          item: material.item,
          critical: material.critical ?? false,
          week: week.week,
          purchaseByDate,
          comprada: material.have ?? false,
        },
      });
      count++;
    }
  }

  return count;
}

async function main() {
  const curriculum = loadCurriculum();

  const leccionesCount = await seedLecciones(curriculum);
  console.log(`Seed de currículo: ${leccionesCount} lecciones cargadas/actualizadas.`);

  const materialesCount = await seedMateriales(curriculum);
  console.log(`Seed de materiales: ${materialesCount} items cargados/actualizados.`);
}

main()
  .catch((err) => {
    console.error('Error corriendo el seed del currículo:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
