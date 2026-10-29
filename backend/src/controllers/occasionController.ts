import { Response } from 'express';
import mongoose from 'mongoose';
import { Occasion } from '../models/Occasion.js';
import { AuthRequest } from '../middleware/auth.js';
import { cleanOccasionName, normalizeOccasionName, validateOccasionName } from '../config/occasions.js';

const shape = (row: { _id: unknown; name: string; isDefault: boolean }) => ({ _id: String(row._id), name: row.name, isDefault: row.isDefault });

export const getOccasions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Defaults first (in creation order), then user-added occasions alphabetically.
    const rows = await Occasion.find().lean();
    rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)
      || (a.isDefault ? +a.createdAt - +b.createdAt || String(a._id).localeCompare(String(b._id)) : a.name.localeCompare(b.name)));
    res.status(200).json({ success: true, count: rows.length, data: rows.map(shape) });
  } catch (error) {
    console.error('Error fetching occasions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch occasions' });
  }
};

export const createOccasion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const name = cleanOccasionName(req.body?.name);
    const problem = validateOccasionName(name);
    if (problem) { res.status(400).json({ success: false, message: problem }); return; }
    const normalizedName = normalizeOccasionName(name);
    const existing = await Occasion.findOne({ normalizedName }).lean();
    if (existing) { res.status(409).json({ success: false, message: `The occasion "${existing.name}" already exists.`, data: shape(existing) }); return; }
    const created = await Occasion.create({ name, normalizedName, isDefault: false, createdBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined });
    res.status(201).json({ success: true, message: `Occasion "${name}" added.`, data: shape(created) });
  } catch (error: any) {
    if (error?.code === 11000) { res.status(409).json({ success: false, message: 'That occasion already exists.' }); return; }
    console.error('Error creating occasion:', error);
    res.status(500).json({ success: false, message: 'Failed to add occasion' });
  }
};
