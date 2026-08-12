export interface Student {
  id: string;
  pin: string;
  name: string;
}

// STUDENTS="jorge:6362:Jorge,georgina:4821:Georgina" — un PIN por hijo, todo
// en env var (nunca en el repo), mismo espíritu que FAMILY_PIN antes: sin
// tabla de usuarios, sin correo, sin contraseña recuperable. Agregar/quitar
// un estudiante es editar esta variable y reiniciar el contenedor.
let cachedStudents: Student[] | null = null;

export function getStudents(): Student[] {
  if (cachedStudents) return cachedStudents;

  const raw = process.env.STUDENTS;
  if (!raw) {
    throw new Error('Falta STUDENTS en las variables de entorno (formato: slug:pin:Nombre,...)');
  }

  cachedStudents = raw.split(',').map((entry) => {
    const [id, pin, name] = entry.split(':');
    if (!id || !pin || !name) {
      throw new Error(`Entrada inválida en STUDENTS: "${entry}" (formato esperado slug:pin:Nombre)`);
    }
    return { id, pin, name };
  });
  return cachedStudents;
}

export function findByPin(pin: string): Student | undefined {
  return getStudents().find((s) => s.pin === pin);
}

export function findById(id: string): Student | undefined {
  return getStudents().find((s) => s.id === id);
}
