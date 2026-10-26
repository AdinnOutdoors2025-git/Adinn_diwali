import { Request, Response } from 'express';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import { Client } from '../models/Client.js';
import { ClientAssociation, VALID_VERTICALS, VerticalType } from '../models/ClientAssociation.js';
import { BD } from '../models/BD.js';
import { findOrCreateClient, normalizeName, normalizeMobile, isValidMobile } from '../utils/normalize.js';

// Helper to validate email format
const isValidEmail = (email?: string): boolean => {
  if (!email || !email.trim()) return true;
  return /^\S+@\S+\.\S+$/.test(email.trim());
};

export const getClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const { vertical, bd, search, page = '1', limit = '10' } = req.query;

    if (!vertical || !bd) {
      res.status(400).json({
        success: false,
        message: 'Both Vertical and BD are required to list clients/vendors.',
      });
      return;
    }

    if (!VALID_VERTICALS.includes(vertical as VerticalType)) {
      res.status(400).json({
        success: false,
        message: `Invalid vertical: ${vertical}`,
      });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(bd as string)) {
      res.status(400).json({
        success: false,
        message: 'Invalid BD ID format',
      });
      return;
    }

    const associationQuery: any = {
      vertical: vertical as string,
      bd: new mongoose.Types.ObjectId(bd as string),
    };

    // If search is provided, find matching clients first
    if (search && typeof search === 'string' && search.trim()) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const matchingClients = await Client.find({
        $or: [
          { name: searchRegex },
          { mobile: searchRegex },
          { email: searchRegex },
        ],
      }).select('_id');

      const clientIds = matchingClients.map((c) => c._id);
      associationQuery.client = { $in: clientIds };
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit as string, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const [total, associations] = await Promise.all([
      ClientAssociation.countDocuments(associationQuery),
      ClientAssociation.find(associationQuery)
        .populate('client')
        .populate('bd')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    // Format output with client details
    const formattedData = associations
      .filter((a) => a.client) // filter out deleted or orphaned clients
      .map((a: any) => ({
        _id: a._id,
        associationId: a._id,
        clientId: a.client._id,
        vertical: a.vertical,
        bd: a.bd,
        name: a.client.name,
        mobile: a.client.mobile,
        email: a.client.email || '',
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }));

    res.status(200).json({
      success: true,
      data: formattedData,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error: any) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch clients', error: error.message });
  }
};

export const createClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { vertical, bd, name, mobile, email } = req.body;

    if (!vertical || !VALID_VERTICALS.includes(vertical)) {
      res.status(400).json({ success: false, message: 'Valid Vertical is required' });
      return;
    }

    if (!bd || !mongoose.Types.ObjectId.isValid(bd)) {
      res.status(400).json({ success: false, message: 'Valid BD is required' });
      return;
    }

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: 'Client/Vendor Name is required' });
      return;
    }

    if (typeof mobile !== 'string' || !isValidMobile(mobile)) {
      res.status(400).json({ success: false, message: 'Mobile Number is required' });
      return;
    }

    const trimmedEmail = email ? email.trim().toLowerCase() : '';
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      res.status(400).json({ success: false, message: 'Invalid email format' });
      return;
    }

    const bdExists = await BD.findById(bd);
    if (!bdExists) {
      res.status(404).json({ success: false, message: 'Selected BD not found in system' });
      return;
    }

    const normMobile = normalizeMobile(mobile);
    const normName = normalizeName(name);
    const confirmExisting = req.body.confirmExisting === true;

    // 1. Phone number is the primary identity; the normalized name is a secondary check.
    let client = await Client.findOne({ normalizedMobile: normMobile });
    if (!client) {
      const nameOwner = await Client.findOne({ normalizedName: normName });
      if (nameOwner) {
        res.status(409).json({
          success: false,
          code: 'NAME_CONFLICT',
          message: `A client named "${nameOwner.name}" is already registered with a different phone number (${nameOwner.mobile}). Use that phone number to add another Vertical and BD.`,
        });
        return;
      }
      try {
        client = await Client.create({ name: name.trim(), normalizedName: normName, mobile: mobile.trim(), normalizedMobile: normMobile, email: trimmedEmail });
        const association = await ClientAssociation.create({ client: client._id, vertical, bd });
        res.status(201).json({
          success: true,
          message: 'Client registered and associated successfully',
          data: { _id: association._id, clientId: client._id, name: client.name, mobile: client.mobile, email: client.email, vertical, bd: bdExists, createdAt: association.createdAt },
        });
        return;
      } catch (error: any) {
        if (error.code !== 11000) throw error;
        // A concurrent request created this identity first: fall through to the existing-client path.
        client = await Client.findOne({ normalizedMobile: normMobile });
        if (!client) {
          res.status(409).json({ success: false, code: 'NAME_CONFLICT', message: 'A client with this name is already registered.' });
          return;
        }
      }
    }

    // 2. Existing client: never create it again; require explicit confirmation to add an association.
    if (!confirmExisting) {
      res.status(409).json({
        success: false,
        code: 'CLIENT_EXISTS',
        message: 'This client/vendor is already registered. Do you want to add another Vertical and BD to the existing record?',
        existingClient: { clientId: client._id, name: client.name, mobile: client.mobile, email: client.email || '' },
      });
      return;
    }

    const existingAssoc = await ClientAssociation.findOne({ client: client._id, vertical, bd });
    if (existingAssoc) {
      res.status(409).json({
        success: false,
        code: 'ASSOCIATION_EXISTS',
        message: `"${client.name}" is already registered under Vertical "${vertical}" and BD "${bdExists.name}". No changes were made.`,
      });
      return;
    }

    if (trimmedEmail && !client.email) { client.email = trimmedEmail; await client.save(); }

    // 3. Add the association only (no sweet distribution is created).
    const association = await ClientAssociation.create({ client: client._id, vertical, bd });
    res.status(201).json({
      success: true,
      message: `Added "${vertical}" and ${bdExists.name} to existing client "${client.name}"`,
      data: { _id: association._id, clientId: client._id, name: client.name, mobile: client.mobile, email: client.email, vertical, bd: bdExists, createdAt: association.createdAt },
    });
  } catch (error: any) {
    console.error('Error creating client:', error);
    if (error.code === 11000) {
      res.status(409).json({ success: false, code: 'ASSOCIATION_EXISTS', message: 'Client is already registered under this Vertical and BD.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create client', error: error.message });
  }
};

export const updateClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, mobile, email } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    // Find association
    const association = await ClientAssociation.findById(id).populate('client');
    if (!association || !association.client) {
      res.status(404).json({ success: false, message: 'Client record not found' });
      return;
    }

    const client = await Client.findById((association.client as any)._id);
    if (!client) {
      res.status(404).json({ success: false, message: 'Master client identity not found' });
      return;
    }

    // Editing a shared identity must not create a second identity for another client.
    const nextName = name === undefined ? client.name : name;
    const nextMobile = mobile === undefined ? client.mobile : mobile;
    if (typeof nextName !== 'string' || !nextName.trim() || typeof nextMobile !== 'string' || !isValidMobile(nextMobile)) {
      res.status(400).json({ success: false, message: 'A client name and valid mobile number are required' });
      return;
    }
    const conflict = await Client.findOne({
      _id: { $ne: client._id },
      $or: [{ normalizedName: normalizeName(nextName) }, { normalizedMobile: normalizeMobile(nextMobile) }],
    });
    if (conflict) {
      res.status(409).json({ success: false, message: 'Another client already uses this name or mobile number. Cancel this edit and add a row to link the existing identity instead.' });
      return;
    }

    if (name !== undefined) {
      if (!name || !name.trim()) {
        res.status(400).json({ success: false, message: 'Client/Vendor Name cannot be empty' });
        return;
      }
      client.name = name.trim();
      client.normalizedName = normalizeName(name);
    }

    if (mobile !== undefined) {
      if (!mobile || !mobile.trim()) {
        res.status(400).json({ success: false, message: 'Mobile Number cannot be empty' });
        return;
      }
      client.mobile = mobile.trim();
      client.normalizedMobile = normalizeMobile(mobile);
    }

    if (email !== undefined) {
      const trimmedEmail = email ? email.trim().toLowerCase() : '';
      if (trimmedEmail && !isValidEmail(trimmedEmail)) {
        res.status(400).json({ success: false, message: 'Invalid email format' });
        return;
      }
      client.email = trimmedEmail;
    }

    await client.save();

    res.status(200).json({
      success: true,
      message: 'Client updated successfully',
      data: {
        _id: association._id,
        clientId: client._id,
        name: client.name,
        mobile: client.mobile,
        email: client.email,
        vertical: association.vertical,
        bd: association.bd,
      },
    });
  } catch (error: any) {
    console.error('Error updating client:', error);
    res.status(500).json({ success: false, message: 'Failed to update client', error: error.message });
  }
};

export const deleteClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const association = await ClientAssociation.findByIdAndDelete(id).populate('client');
    if (!association) {
      res.status(404).json({ success: false, message: 'Client association not found' });
      return;
    }

    // Check if client is used in other associations; if not, we can keep or clean
    const clientName = (association.client as any)?.name || 'Client';

    res.status(200).json({
      success: true,
      message: `Client "${clientName}" unlinked from Vertical and BD successfully`,
    });
  } catch (error: any) {
    console.error('Error deleting client:', error);
    res.status(500).json({ success: false, message: 'Failed to delete client', error: error.message });
  }
};

export const bulkImportClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const { vertical, bd, records } = req.body;

    if (!vertical || !VALID_VERTICALS.includes(vertical)) {
      res.status(400).json({ success: false, message: 'Valid Vertical is required' });
      return;
    }

    if (!bd || !mongoose.Types.ObjectId.isValid(bd)) {
      res.status(400).json({ success: false, message: 'Valid BD is required' });
      return;
    }

    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ success: false, message: 'No records provided for import' });
      return;
    }

    const bdExists = await BD.findById(bd);
    if (!bdExists) {
      res.status(404).json({ success: false, message: 'Selected BD not found in system' });
      return;
    }

    const seenInBatch = new Set<string>();
    let successful = 0;
    let duplicates = 0;
    let invalid = 0;
    const errors: string[] = [];

    for (let index = 0; index < records.length; index++) {
      const row = records[index];
      const rawName = row.name || row['Client/Vendor Name'] || row['Client Name'] || row['Vendor Name'] || '';
      const rawMobile = row.mobile || row['Mobile Number'] || row['Mobile'] || row['Phone'] || '';
      const rawEmail = row.email || row['Email ID'] || row['Email'] || '';

      const name = typeof rawName === 'string' ? rawName.trim() : String(rawName).trim();
      const mobile = typeof rawMobile === 'string' ? rawMobile.trim() : String(rawMobile).trim();
      const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : String(rawEmail || '').trim().toLowerCase();

      // Name required
      if (!name) {
        invalid++;
        errors.push(`Row ${index + 1}: Name is required`);
        continue;
      }

      // Mobile required
      if (!isValidMobile(mobile)) {
        invalid++;
        errors.push(`Row ${index + 1} (${name}): Mobile number is required`);
        continue;
      }

      // Email format if provided
      if (email && !isValidEmail(email)) {
        invalid++;
        errors.push(`Row ${index + 1} (${name}): Invalid email format "${email}"`);
        continue;
      }

      const normMobile = normalizeMobile(mobile);
      const batchKey = normMobile || normalizeName(name);

      if (seenInBatch.has(batchKey)) {
        duplicates++;
        errors.push(`Row ${index + 1} (${name}): Duplicate within uploaded file`);
        continue;
      }
      seenInBatch.add(batchKey);

      // Find or create master client
      const { client } = await findOrCreateClient({ name, mobile, email });

      // Check if already associated with this Vertical + BD
      const existing = await ClientAssociation.findOne({
        client: client._id,
        vertical,
        bd,
      });

      if (existing) {
        duplicates++;
        errors.push(`Row ${index + 1} (${name}): Already registered under this Vertical & BD`);
        continue;
      }

      // Create association only (NO distribution record created)
      await ClientAssociation.create({
        client: client._id,
        vertical,
        bd,
      });

      successful++;
    }

    res.status(200).json({
      success: true,
      message: `Import completed: ${successful} imported, ${duplicates} duplicates skipped, ${invalid} invalid`,
      summary: {
        totalReceived: records.length,
        successful,
        duplicates,
        invalid,
        skipped: duplicates + invalid,
      },
      errors: errors.slice(0, 20),
    });
  } catch (error: any) {
    console.error('Error during bulk import:', error);
    res.status(500).json({ success: false, message: 'Bulk import failed', error: error.message });
  }
};

export const downloadSampleTemplate = (req: Request, res: Response): void => {
  try {
    const data = [
      {
        'Client/Vendor Name': 'Acme Global Media Ltd',
        'Mobile Number': '9876543210',
        'Email ID': 'contact@acmeglobal.com',
      },
      {
        'Client/Vendor Name': 'Apex Billboard Enterprises',
        'Mobile Number': '9812345678',
        'Email ID': 'sales@apexenterprise.com',
      },
      {
        'Client/Vendor Name': 'Metro Arts & Prints',
        'Mobile Number': '9840123987',
        'Email ID': 'info@metroarts.in',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 30 }, // Client/Vendor Name
      { wch: 18 }, // Mobile Number
      { wch: 28 }, // Email ID
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Clients_Vendors');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Diwali_Sweet_Distribution_Sample_Template.xlsx"');
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating sample template:', error);
    res.status(500).json({ success: false, message: 'Could not generate template' });
  }
};
