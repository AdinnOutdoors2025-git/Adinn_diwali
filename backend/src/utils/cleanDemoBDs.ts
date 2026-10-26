import dotenv from 'dotenv';
dotenv.config();

import { connectDB } from '../config/db.js';
import { BD } from '../models/BD.js';
import { ClientVendor } from '../models/ClientVendor.js';

export const cleanDemoBDs = async () => {
  try {
    console.log('[Cleanup] Connecting to database...');
    await connectDB();

    const demoEmails = [
      'rajesh.sharma@adinn.com',
      'priya.v@adinn.com',
      'arun.kumar@adinn.com',
      'kavitha.s@adinn.com',
    ];

    // Find all demo BDs or test BDs
    const demoBDs = await BD.find({
      $or: [
        { email: { $in: demoEmails } },
        { email: { $regex: /test\.bd/i } },
        { name: { $regex: /test bd/i } },
      ],
    });

    console.log(`[Cleanup] Found ${demoBDs.length} demo BD record(s) to remove.`);

    for (const bd of demoBDs) {
      // Remove clients under this BD
      const delClients = await ClientVendor.deleteMany({ bd: bd._id });
      console.log(`[Cleanup] Deleted ${delClients.deletedCount} client/vendor records for BD "${bd.name}" (${bd.email}).`);
      
      // Delete the BD
      await BD.findByIdAndDelete(bd._id);
      console.log(`[Cleanup] Deleted BD "${bd.name}".`);
    }

    const remainingBDs = await BD.countDocuments();
    console.log(`[Cleanup] Complete! Total remaining BDs in database: ${remainingBDs}`);
  } catch (err: any) {
    console.error('[Cleanup] Error:', err.message);
  }
};

cleanDemoBDs().then(() => {
  process.exit(0);
});

