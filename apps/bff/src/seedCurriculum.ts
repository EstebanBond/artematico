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

interface WeekYaml {
  week: number;
  technique: string;
  tema: string;
  papel: string | string[];
  criterios_foco: string[];
  fallback?: FallbackYaml;
  days: DayYaml[];
}

interface CurriculumYaml {
  weeks: WeekYaml[];
}

function loadCurriculum(): CurriculumYaml {
  const contentDir = process.env.CONTENT_DIR ?? path.join(process.cwd(), '..', '..', 'content');
  const filePath = path.join(contentDir, 'curriculum.yaml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(raw) as CurriculumYaml;
}

async function main() {
  const curriculum = loadCurriculum();

  let count = 0;
  for (const week of curriculum.weeks) {
    const papel = Array.isArray(week.papel) ? week.papel.join(', ') : week.papel;
    const fallbackDisableCriteria = week.fallback?.disable_criteria ?? [];

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
        },
      });
      count++;
    }
  }

  console.log(`Seed de currículo: ${count} lecciones cargadas/actualizadas.`);
}

main()
  .catch((err) => {
    console.error('Error corriendo el seed del currículo:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
