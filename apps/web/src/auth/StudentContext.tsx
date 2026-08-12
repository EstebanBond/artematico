import { createContext, useContext } from 'react';

export interface StudentInfo {
  studentId: string;
  studentName: string;
}

const StudentContext = createContext<StudentInfo | null>(null);

export const StudentProvider = StudentContext.Provider;

export function useStudent(): StudentInfo {
  const student = useContext(StudentContext);
  if (!student) {
    throw new Error('useStudent() solo puede usarse dentro de <AuthGate> ya autenticado');
  }
  return student;
}
