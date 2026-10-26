import { Request, Response, NextFunction } from 'express';
import { isDatabaseConnected } from '../config/db.js';

// Distinguishes "database unreachable" (503) from "no records yet" (200 with an empty list).
export const requireDatabase = (req: Request, res: Response, next: NextFunction): void => {
  if (isDatabaseConnected()) { next(); return; }
  res.status(503).json({ success: false, code: 'DB_UNAVAILABLE', message: 'The database is currently unavailable. Please try again shortly.' });
};
