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
    res.status(500).json({ success: false, message: 'Failed to fetch Requestees', error: error.message });
  }
};

export const createBD = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email } = req.body;

    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ success: false, message: 'Requestee Name is required' });
      return;
    }

    if (typeof email !== 'string' || !email.trim()) {
      res.status(400).json({ success: false, message: 'Requestee Email ID is required' });
      return;
    }

    const trimmedName = name.trim().replace(/\s+/g, ' ');
    if (trimmedName.length > 120) {
      res.status(400).json({ success: false, message: 'Requestee Name must be 120 characters or fewer' });
      return;
    }
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
        message: `A Requestee with email "${trimmedEmail}" already exists (${existingByEmail.name}).`,
      });
      return;
    }

    // Check duplicate by name (case-insensitive, ignoring extra spaces)
    const existingByName = await BD.findOne({
      name: { $regex: new RegExp(`^\\s*${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\s*$`, 'i') },
    });
    if (existingByName) {
      res.status(409).json({
        success: false,
        message: `A Requestee with name "${existingByName.name}" already exists with email ${existingByName.email}.`,
      });
      return;
    }

    const newBD = await BD.create({
      name: trimmedName,
      email: trimmedEmail,
    });

    res.status(201).json({
      success: true,
      message: 'Requestee created successfully',
      data: newBD,
    });
  } catch (error: any) {
    console.error('Error creating BD:', error);
    if (error.code === 11000) {
      res.status(409).json({ success: false, message: 'Requestee with this email already exists' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create Requestee', error: error.message });
  }
};

export const deleteBD = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid Requestee ID' });
      return;
    }

    const bd = await BD.findByIdAndDelete(id);
    if (!bd) {
      res.status(404).json({ success: false, message: 'Requestee not found' });
      return;
    }

    // Also remove client/vendor records associated with this BD
    await ClientVendor.deleteMany({ bd: id });

    res.status(200).json({
      success: true,
      message: `Requestee "${bd.name}" and associated records removed successfully.`,
    });
  } catch (error: any) {
    console.error('Error deleting BD:', error);
    res.status(500).json({ success: false, message: 'Failed to delete Requestee', error: error.message });
  }
};
