import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User, IUser } from '../models/User.js';
import { generateToken } from '../config/jwt.js';
import { AuthRequest } from '../middleware/auth.js';

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: trimmedEmail });

    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    // Role check if user selected specific portal (e.g. Staff portal vs CMD portal)
    if (role && user.role !== role) {
      res.status(403).json({
        success: false,
        message: `Account has role '${user.role}', but you are attempting to log into the '${role}' portal. Please select the correct login tab.`,
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const token = generateToken({
      id: (user._id as any).toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login', error: error.message });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error: any) {
    console.error('getMe error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching user details' });
  }
};

export const seedDefaultUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const defaultStaffEmail = 'staff@adinn.com';
    const defaultCmdEmail = 'cmd@adinn.com';

    let staff = await User.findOne({ email: defaultStaffEmail });
    if (!staff) {
      const passwordHash = await bcrypt.hash('Staff@123', 10);
      staff = await User.create({
        name: 'Staff Operations',
        email: defaultStaffEmail,
        passwordHash,
        role: 'STAFF',
      });
    }

    let cmd = await User.findOne({ email: defaultCmdEmail });
    if (!cmd) {
      const passwordHash = await bcrypt.hash('Cmd@123', 10);
      cmd = await User.create({
        name: 'CMD Executive',
        email: defaultCmdEmail,
        passwordHash,
        role: 'CMD',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Default users initialized',
      accounts: [
        { email: defaultStaffEmail, role: 'STAFF', note: 'Staff@123' },
        { email: defaultCmdEmail, role: 'CMD', note: 'Cmd@123' },
      ],
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error seeding default users', error: error.message });
  }
};

