import { Request, Response } from 'express';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import { Client } from '../models/Client.js';
import { ClientAssociation } from '../models/ClientAssociation.js';
import { SweetDistribution } from '../models/SweetDistribution.js';
import { CLIENT_TYPES, MAX_ALLOWED_QUANTITY, isClientType, parseWholeNumber } from '../config/distribution.js';
import { BD } from '../models/BD.js';
import { findOrCreateClient, normalizeName, normalizeMobile, isValidMobile, isTenDigitMobile, PHONE_MESSAGE } from '../utils/normalize.js';

// Helper to validate email format
const isValidEmail = (email?: string): boolean => {
  if (!email || !email.trim()) return true;
  return /^\S+@\S+\.\S+$/.test(email.trim());
};

// Undefined means "not supplied" (callers apply a default); anything else must be a whole number in range.
const parseAllowedQuantity = (value: unknown): { value?: number; error?: string } => {
  if (value === undefined || value === null || value === '') return {};
  const parsed = parseWholeNumber(value);
  if (parsed === null || parsed < 1 || parsed > MAX_ALLOWED_QUANTITY) return { error: `Allowed Quantity must be a whole number between 1 and ${MAX_ALLOWED_QUANTITY}` };
  return { value: parsed };
};

export const getClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, bd, search, page = '1', limit = '10' } = req.query;

    if (!type || !bd) {
      res.status(400).json({
        success: false,
        message: 'Both Type and Requestee Name are required to list clients/vendors.',
      });
      return;
    }

    if (!isClientType(type)) {
      res.status(400).json({
        success: false,
        message: `Invalid type: ${type}`,
      });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(bd as string)) {
      res.status(400).json({
        success: false,
        message: 'Invalid Requestee ID format',
      });
      return;
    }

    const associationQuery: any = {
      type: type as string,
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
        type: a.type,
        bd: a.bd,
        name: a.client.name,
        mobile: a.client.mobile,
        email: a.client.email || '',
        allowedQuantity: a.client.allowedQuantity ?? 1,
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
    const { type, bd, name, mobile, email } = req.body;

    if (!isClientType(type)) {
      res.status(400).json({ success: false, message: `Valid Type is required (${CLIENT_TYPES.join(', ')})` });
      return;
    }

    if (!bd || !mongoose.Types.ObjectId.isValid(bd)) {
      res.status(400).json({ success: false, message: 'Valid Requestee Name is required' });
      return;
    }

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, message: 'Client/Vendor Name is required' });
      return;
    }

    if (typeof mobile !== 'string' || !isTenDigitMobile(mobile)) {
      res.status(400).json({ success: false, message: PHONE_MESSAGE });
      return;
    }

    const trimmedEmail = email ? email.trim().toLowerCase() : '';
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      res.status(400).json({ success: false, message: 'Invalid email format' });
      return;
    }

    const quantity = parseAllowedQuantity(req.body.allowedQuantity);
    if (quantity.error) {
      res.status(400).json({ success: false, message: quantity.error });
      return;
    }

    const bdExists = await BD.findById(bd);
    if (!bdExists) {
      res.status(404).json({ success: false, message: 'Selected Requestee not found in system' });
      return;
    }

    const normMobile = normalizeMobile(mobile);
    const normName = normalizeName(name);
    const confirmExisting = req.body.confirmExisting === true;

    // 1. Identity is global and year-independent: phone number first, then the exact normalized name
    //    (trimmed, whitespace-collapsed, case-insensitive). Similar-but-different names are never merged.
    const findExisting = async () => {
      const byMobile = await Client.findOne({ normalizedMobile: normMobile });
      if (byMobile) return { client: byMobile, matchedBy: 'mobile' as const };
      const byName = await Client.findOne({ normalizedName: normName });
      return byName ? { client: byName, matchedBy: 'name' as const } : null;
    };
    let match = await findExisting();
    let isNew = false;
    if (!match) {
      try {
        const created = await Client.create({ name: name.trim(), normalizedName: normName, mobile: mobile.trim(), normalizedMobile: normMobile, email: trimmedEmail, allowedQuantity: quantity.value ?? 1 });
        const association = await ClientAssociation.create({ client: created._id, type, bd });
        res.status(201).json({
          success: true,
          message: 'Client registered and associated successfully',
          data: { _id: association._id, clientId: created._id, name: created.name, mobile: created.mobile, email: created.email, allowedQuantity: created.allowedQuantity, type, bd: bdExists, createdAt: association.createdAt },
        });
        return;
      } catch (error: any) {
        if (error.code !== 11000) throw error;
        // A concurrent request created this identity first: fall through to the existing-client path.
        match = await findExisting();
        if (!match) throw error;
      }
    }
    const client = match.client;

    // 2. Existing client: never create it again; require explicit confirmation to add an association.
    if (!confirmExisting) {
      res.status(409).json({
        success: false,
        code: 'CLIENT_EXISTS',
        matchedBy: match.matchedBy,
        message: match.matchedBy === 'mobile'
          ? 'This client/vendor is already registered. Do you want to add another Type and Requestee to the existing record?'
          : `A client named "${client.name}" is already registered with phone ${client.mobile}. Do you want to add another Type and Requestee to that existing record?`,
        existingClient: { clientId: client._id, name: client.name, mobile: client.mobile, email: client.email || '', allowedQuantity: client.allowedQuantity ?? 1 },
      });
      return;
    }

    const existingAssoc = await ClientAssociation.findOne({ client: client._id, type, bd });
    if (existingAssoc) {
      res.status(409).json({
        success: false,
        code: 'ASSOCIATION_EXISTS',
        message: `"${client.name}" is already registered under Type "${type}" and Requestee "${bdExists.name}". No changes were made.`,
      });
      return;
    }

    if (trimmedEmail && !client.email) { client.email = trimmedEmail; await client.save(); }

    // 3. Add the association only (no sweet distribution is created).
    const association = await ClientAssociation.create({ client: client._id, type, bd });
    res.status(201).json({
      success: true,
      message: `Added "${type}" and ${bdExists.name} to existing client "${client.name}"`,
      data: { _id: association._id, clientId: client._id, name: client.name, mobile: client.mobile, email: client.email, allowedQuantity: client.allowedQuantity ?? 1, type, bd: bdExists, createdAt: association.createdAt },
    });
  } catch (error: any) {
    console.error('Error creating client:', error);
    if (error.code === 11000) {
      res.status(409).json({ success: false, code: 'ASSOCIATION_EXISTS', message: 'Client is already registered under this Type and Requestee.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to create client', error: error.message });
  }
};

export const updateClient = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, mobile, email, type } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid ID' });
      return;
    }

    const quantity = parseAllowedQuantity(req.body.allowedQuantity);
    if (quantity.error || (req.body.allowedQuantity === null || req.body.allowedQuantity === '')) {
      res.status(400).json({ success: false, message: quantity.error || `Allowed Quantity must be a whole number between 1 and ${MAX_ALLOWED_QUANTITY}` });
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
    if (typeof nextName !== 'string' || !nextName.trim() || typeof nextMobile !== 'string') {
      res.status(400).json({ success: false, message: 'A client name and valid mobile number are required' });
      return;
    }
    // A changed number must meet the 10-digit rule. An unchanged one may keep its older stored format,
    // so existing records stay editable.
    const mobileChanged = mobile !== undefined && mobile.trim() !== client.mobile;
    if (mobileChanged ? !isTenDigitMobile(nextMobile) : !isValidMobile(nextMobile)) {
      res.status(400).json({ success: false, message: mobileChanged ? PHONE_MESSAGE : 'A client name and valid mobile number are required' });
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

    // Only records created before Type existed may be assigned one; an existing Type is not changed here.
    if (type !== undefined && !association.type) {
      if (!isClientType(type)) {
        res.status(400).json({ success: false, message: `Valid Type is required (${CLIENT_TYPES.join(', ')})` });
        return;
      }
      if (await ClientAssociation.exists({ client: client._id, type, bd: association.bd, _id: { $ne: association._id } })) {
        res.status(409).json({ success: false, message: `This client is already registered under Type "${type}" and this Requestee.` });
        return;
      }
      association.type = type;
      await association.save();
    }

    // Lowering Allowed Quantity must not undercut a distribution that is still in progress. The check runs
    // before and after the write: a distribution created concurrently runs the mirror check, so one side always loses.
    const previousQuantity = client.allowedQuantity ?? 1;
    const lowering = quantity.value !== undefined && quantity.value < previousQuantity;
    const overLimit = (limit: number) => SweetDistribution.exists({ client: client._id, isReverted: { $ne: true }, status: { $ne: 'DELIVERED' }, quantity: { $gt: limit } });
    if (quantity.value !== undefined) {
      if (lowering && await overLimit(quantity.value)) {
        res.status(409).json({ success: false, message: `Allowed Quantity cannot be lower than the quantity of a distribution that is still in progress.` });
        return;
      }
      client.allowedQuantity = quantity.value;
    }

    await client.save();

    if (lowering && await overLimit(quantity.value!)) {
      client.allowedQuantity = previousQuantity;
      await client.save();
      res.status(409).json({ success: false, message: 'A distribution was recorded at the higher quantity while saving. Allowed Quantity was not changed.' });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Client updated successfully',
      data: {
        _id: association._id,
        clientId: client._id,
        name: client.name,
        mobile: client.mobile,
        email: client.email,
        allowedQuantity: client.allowedQuantity ?? 1,
        type: association.type,
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
      message: `Client "${clientName}" unlinked from Type and Requestee successfully`,
    });
  } catch (error: any) {
    console.error('Error deleting client:', error);
    res.status(500).json({ success: false, message: 'Failed to delete client', error: error.message });
  }
};

// Each row carries its own Type and Requestee (by email or exact name), so one file can span several of both.
// Top-level `type` / `bd` are optional defaults for rows that leave them blank.
export const bulkImportClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type: defaultType, bd: defaultBD, records } = req.body;

    if (defaultType !== undefined && defaultType !== '' && !isClientType(defaultType)) {
      res.status(400).json({ success: false, message: `Valid Type is required (${CLIENT_TYPES.join(', ')})` });
      return;
    }
    if (defaultBD !== undefined && defaultBD !== '' && !mongoose.Types.ObjectId.isValid(defaultBD)) {
      res.status(400).json({ success: false, message: 'Valid Requestee Name is required' });
      return;
    }
    if (!Array.isArray(records) || records.length === 0) {
      res.status(400).json({ success: false, message: 'No records provided for import' });
      return;
    }
    if (records.length > 5000) {
      res.status(400).json({ success: false, message: 'Import at most 5000 rows at a time' });
      return;
    }

    const bds = await BD.find().lean();
    const bdByKey = new Map<string, (typeof bds)[number] | null>();
    for (const bd of bds) {
      for (const key of [String(bd._id), bd.email.toLowerCase(), normalizeName(bd.name)]) {
        // A name shared by two Requestees is ambiguous and must be given as an email instead.
        bdByKey.set(key, bdByKey.has(key) && String(bdByKey.get(key)?._id) !== String(bd._id) ? null : bd);
      }
    }
    const defaultBDDoc = defaultBD ? bdByKey.get(String(defaultBD)) : undefined;
    if (defaultBD && !defaultBDDoc) {
      res.status(404).json({ success: false, message: 'Selected Requestee not found in system' });
      return;
    }

    const text = (value: unknown) => (value === undefined || value === null ? '' : String(value).trim());
    const seenInBatch = new Set<string>();
    let successful = 0;
    let duplicates = 0;
    let invalid = 0;
    const errors: string[] = [];
    const fail = (message: string) => { invalid++; errors.push(message); };

    for (let index = 0; index < records.length; index++) {
      const row = records[index] || {};
      const name = text(row.name || row['Client/Vendor Name'] || row['Client Name'] || row['Vendor Name']);
      const mobile = text(row.mobile || row['Mobile Number'] || row['Mobile'] || row['Phone']);
      const email = text(row.email || row['Email ID'] || row['Email']).toLowerCase();
      const label = `Row ${index + 1}${name ? ` (${name})` : ''}`;

      if (!name) { fail(`Row ${index + 1}: Name is required`); continue; }
      if (!isTenDigitMobile(mobile)) { fail(`${label}: ${PHONE_MESSAGE}`); continue; }
      if (email && !isValidEmail(email)) { fail(`${label}: Invalid email format "${email}"`); continue; }

      const type = text(row.type || row['Type']) || defaultType;
      if (!isClientType(type)) { fail(`${label}: Type must be one of ${CLIENT_TYPES.join(', ')}`); continue; }

      const requesteeRaw = text(row.requestee || row['Requestee Email'] || row['Requestee Name'] || row['Requestee']);
      const bd = requesteeRaw ? bdByKey.get(requesteeRaw.toLowerCase()) ?? bdByKey.get(normalizeName(requesteeRaw)) : defaultBDDoc;
      if (!bd) { fail(`${label}: ${requesteeRaw ? `Requestee "${requesteeRaw}" was not found or is ambiguous (use the email)` : 'Requestee is required'}`); continue; }

      const quantity = parseAllowedQuantity(row.allowedQuantity ?? row['Allowed Quantity']);
      if (quantity.error) { fail(`${label}: ${quantity.error}`); continue; }

      const batchKey = `${normalizeMobile(mobile) || normalizeName(name)}|${type}|${bd._id}`;
      if (seenInBatch.has(batchKey)) {
        duplicates++;
        errors.push(`${label}: Duplicate within uploaded file`);
        continue;
      }
      seenInBatch.add(batchKey);

      // Find or create master client (an existing client keeps its own Allowed Quantity)
      const { client } = await findOrCreateClient({ name, mobile, email, allowedQuantity: quantity.value });

      const existing = await ClientAssociation.findOne({ client: client._id, type, bd: bd._id });
      if (existing) {
        duplicates++;
        errors.push(`${label}: Already registered under this Type & Requestee`);
        continue;
      }

      // Create association only (NO distribution record created)
      try {
        await ClientAssociation.create({ client: client._id, type, bd: bd._id });
      } catch (error: any) {
        if (error.code !== 11000) throw error;
        duplicates++;
        errors.push(`${label}: Already registered under this Type & Requestee`);
        continue;
      }
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
      errors: errors.slice(0, 50),
    });
  } catch (error: any) {
    console.error('Error during bulk import:', error);
    res.status(500).json({ success: false, message: 'Bulk import failed', error: error.message });
  }
};

export const downloadSampleTemplate = (req: Request, res: Response): void => {
  try {
    const data = [
      { 'Client/Vendor Name': 'Acme Global Media Ltd', 'Mobile Number': '9876543210', 'Email ID': 'contact@acmeglobal.com', Type: 'Client', 'Requestee Email': 'requestee@adinn.co.in', 'Allowed Quantity': 2 },
      { 'Client/Vendor Name': 'Apex Billboard Enterprises', 'Mobile Number': '9812345678', 'Email ID': 'sales@apexenterprise.com', Type: 'Vendor', 'Requestee Email': 'requestee@adinn.co.in', 'Allowed Quantity': 1 },
      { 'Client/Vendor Name': 'Metro Arts & Prints', 'Mobile Number': '9840123987', 'Email ID': 'info@metroarts.in', Type: 'OOH Landlords', 'Requestee Email': 'requestee@adinn.co.in', 'Allowed Quantity': 1 },
    ];

    const worksheet = XLSX.utils.json_to_sheet(data);
    worksheet['!cols'] = [
      { wch: 30 }, { wch: 18 }, { wch: 28 }, { wch: 16 }, { wch: 28 }, { wch: 16 },
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
