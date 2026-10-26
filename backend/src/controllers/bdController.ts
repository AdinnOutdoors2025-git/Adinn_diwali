import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { BD } from '../models/BD.js';
import { ClientVendor } from '../models/ClientVendor.js';

export const getBDs = async (req: Request, res: Response): Promise<void> => {
  try {
    const bds = await BD.find().sort({ name: 1 });
    res.status(200).json({
      success: true,
      count: bds.length,
      data: bds,
    });
  } catch (error: any) {
    console.error('Error fetching BDs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch BDs', error: error.message });
  }
};

export const createBD = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: 'BD Name is required' });
      return;
    }

    if (!email || !email.trim()) {
      res.status(400).json({ success: false, message: 'BD Email ID is required' });
      return;
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    // Email format validation
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(trimmedEmail)) {
      res.status(400).json({ success: false, message: 'Please provide a valid email address' });
      return;
    }

    // Check duplicate by email
    const existingByEmail = await BD.findOne({ email: trimmedEmail });
    if (existingByEmail) {
      res.status(409).json({
        success: false,
        message: `A Business Developer with email "${trimmedEmail}" already exists (${existingByEmail.name}).`,
      });
      return;
    }

    // Check duplicate by exact name (case-insensitive)
    const existingByName = await BD.findOne({
      name: { $regex: new RegExp(`^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });
    if (existingByName) {
      res.status(409).json({
        success: false,
        message: `A Business Developer with name "${existingByName.name}" already exists with email ${existingByName.email}.`,
      });
      return;
    }

    const newBD = await BD.create({
      name: trimmedName,
      email: trimmedEmail,
    });

    res.status(201).json({
      success: true,
      message: 'Business Developer created successfully',
      data: newBD,
    });
  } catch (error: any) {
    console.error('Error creating BD:', error);
    if (error.code === 11000) {
      res.status(409).json({ success: false, message: 'BD with this email already exists' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create BD', error: error.message });
  }
};

export const deleteBD = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid BD ID' });
      return;
    }

    const bd = await BD.findByIdAndDelete(id);
    if (!bd) {
      res.status(404).json({ success: false, message: 'Business Developer not found' });
      return;
    }

    // Also remove client/vendor records associated with this BD
    await ClientVendor.deleteMany({ bd: id });

    res.status(200).json({
      success: true,
      message: `Business Developer "${bd.name}" and associated records removed successfully.`,
    });
  } catch (error: any) {
    console.error('Error deleting BD:', error);
    res.status(500).json({ success: false, message: 'Failed to delete BD', error: error.message });
  }
};
