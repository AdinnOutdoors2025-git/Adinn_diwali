import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import { User } from '../models/User.js';

export const seedInitialData = async () => {
  try {
    console.log('[Seed] Checking default admin/staff users...');

    // 1. Staff User
    const staffEmail = 'staff@adinn.com';
    let staffUser = await User.findOne({ email: staffEmail });
    if (!staffUser) {
      const passwordHash = await bcrypt.hash('Staff@123', 10);
      staffUser = await User.create({
        name: 'Adinn Staff Operations',
        email: staffEmail,
        passwordHash,
        role: 'STAFF',
      });
      console.log(`[Seed] Created default STAFF user: ${staffEmail}`);
    }

    // 2. CMD User
    const cmdEmail = 'cmd@adinn.com';
    let cmdUser = await User.findOne({ email: cmdEmail });
    if (!cmdUser) {
      const passwordHash = await bcrypt.hash('Cmd@123', 10);
      cmdUser = await User.create({
        name: 'Managing Director & CMD',
        email: cmdEmail,
        passwordHash,
        role: 'CMD',
      });
      console.log(`[Seed] Created default CMD user: ${cmdEmail}`);
    }

    // Note: No demo BDs or demo clients are seeded. Staff can add real BDs via the "+" button on the Entry page.
  } catch (error: any) {
    console.error('[Seed] Error seeding data:', error.message);
  }
};

// If executed directly from CLI: npm run seed
if (process.argv[1]?.includes('seedData')) {
  (async () => {
    await connectDB();
    await seedInitialData();
    console.log('[Seed] Seeding finished. Exiting.');
    process.exit(0);
  })();
}
