// Tipos escritos a mano que reflejan EXACTAMENTE el SDL de apps/bff/src/schema.graphql.
// Simplificación conocida de esta rebanada: aún no hay codegen de cliente conectado
// a este paquete. No inventar campos que no estén en el SDL.

export type SubmissionStatus = 'uploaded' | 'queued' | 'evaluating' | 'evaluated' | 'failed';

export interface Lesson {
  id: string;
  week: number;
  dayIndex: number;
  technique: string;
  tema: string;
  papel: string;
  consigna: string;
  criteriosFoco: string[];
  videoUrl: string | null;
}

export interface CriterioEvaluacion {
  criterio: string;
  nivel: number;
  evidencia: string;
}

export interface MicroEjercicio {
  instruccion: string;
  minutos: number;
}

export interface CalidadFoto {
  usable: boolean;
  problemas: string[];
}

export interface Evaluation {
  criteriosFoco: CriterioEvaluacion[];
  loQueFunciona: string;
  loQueSigue: string;
  microEjercicio: MicroEjercicio;
  huellaEstilo: string[];
  banderaParaPapa: string | null;
  calidadFoto: CalidadFoto;
  promptSha256: string;
  model: string;
  createdAt: string;
}

export interface Submission {
  id: string;
  status: SubmissionStatus;
  objectKey: string;
  sessionNumber: number;
  createdAt: string;
  evaluation: Evaluation | null;
}

export interface TodayResult {
  lesson: Lesson;
  recentSubmissions: Submission[];
}

export interface CriterioRatingInput {
  criterio: string;
  nivel: number;
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

export interface BanderaEscalada {
  submissionId: string;
  sessionNumber: number;
  lessonTema: string;
  texto: string;
  createdAt: string;
}

export interface ParentPanelData {
  banderas: BanderaEscalada[];
  comprasPendientes: CompraPendiente[];
}
