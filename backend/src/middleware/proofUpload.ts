import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import { MAX_PROOF_BYTES } from '../config/distribution.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_BYTES, files: 1, fields: 10 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (file.mimetype !== 'image/jpeg' || !['.jpg', '.jpeg'].includes(extension)) {
      callback(Object.assign(new Error('Delivery proof must be a JPEG/JPG image.'), { code: 'INVALID_PROOF_TYPE' }));
      return;
    }
    callback(null, true);
  },
}).single('proof');

// Runs multer and converts its failures into the API's JSON error shape.
export const uploadProof = (req: Request, res: Response, next: NextFunction): void => {
  upload(req, res, (error: any) => {
    if (!error) { next(); return; }
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ success: false, message: `Delivery proof must be ${MAX_PROOF_BYTES / 1024 / 1024} MB or smaller.` }); return;
    }
    if (error.code === 'INVALID_PROOF_TYPE' || error instanceof multer.MulterError) {
      res.status(400).json({ success: false, message: error.code === 'INVALID_PROOF_TYPE' ? error.message : 'Invalid upload. Send a single JPEG file in the "proof" field.' }); return;
    }
    next(error);
  });
};
