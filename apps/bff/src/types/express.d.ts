import 'express';

declare global {
  namespace Express {
    interface Request {
      studentId?: string;
    }
  }
}
