// Traducción de códigos internos (fijos a los enums de packages/rubric/rubric.schema.json
// y content/curriculum.yaml) a texto cálido para que Jorge lo lea solo, sin su papá al lado.
// Si aparece un código sin traducir, se muestra tal cual en vez de romper la pantalla.

const TECHNIQUE_LABELS: Record<string, string> = {
  grafito_linea: 'Dibujo a mano con lápiz: línea',
  grafito_valor: 'Dibujo a lápiz: luces y sombras',
  tinta: 'Dibujo con tinta',
  lapiz_color: 'Dibujo a color',
  acuarela: 'Pintura con acuarela',
  linea_tecnica: 'Dibujo con regla y escuadras',
  tecnica_mixta: 'Diseño de personajes',
  comic: 'Cómic',
};

const PAPEL_LABELS: Record<string, string> = {
  bond_75: 'Hoja blanca (bond)',
  bond_90: 'Hoja blanca (bond)',
  couche: 'Hoja blanca brillante (couché)',
  algodon_300: 'Papel especial de acuarela',
  opalina: 'Hoja blanca lisa (opalina)',
  hojas_de_color: 'Hojas de colores',
};

const CRITERIO_LABELS: Record<string, string> = {
  trazo_linea: 'Cómo trazas tus líneas',
  proporcion_escala: 'Que las proporciones se vean bien',
  valor_luz_sombra: 'Luces y sombras',
  textura: 'Las texturas',
  composicion: 'Cómo acomodas tu dibujo en la hoja',
  espacio_perspectiva: 'La sensación de profundidad',
  color: 'El uso del color',
  narrativa_expresion: 'Que tu dibujo cuente algo',
};

export function friendlyTechnique(code: string): string {
  return TECHNIQUE_LABELS[code] ?? code;
}

export function friendlyPapel(raw: string): string {
  return raw
    .split(', ')
    .map((code) => PAPEL_LABELS[code] ?? code)
    .join(' y ');
}

export function friendlyCriterio(code: string): string {
  return CRITERIO_LABELS[code] ?? code;
}
