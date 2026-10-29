import crypto from 'node:crypto';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { SweetDistribution } from '../models/SweetDistribution.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { ClientAssociation } from '../models/ClientAssociation.js';
import { Client } from '../models/Client.js';
import { BD } from '../models/BD.js';
import { AuthRequest } from '../middleware/auth.js';
import { getProofStorage } from '../config/proofStorage.js';
import { FIRST_DIWALI_YEAR, isRecordableYear } from '../config/diwaliYear.js';
import {
  DELIVERY_STATUSES, DeliveryStatus, DISTRIBUTION_MODES, STATUS_FLOW, isClientType, isDistributionMode, nextStatus, DISTRIBUTION_QUANTITY, quantityState,
} from '../config/distribution.js';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getDistributionRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const { year, type, bd, search, status = 'ALL', mode = 'ALL', deliveryStatus = 'ALL', page = '1', limit = '10' } = req.query;
    const currentYear = Number(year || new Date().getFullYear());
    const modeFilter = String(mode), deliveryFilter = String(deliveryStatus);
    // A delivery stage only has meaning within one workflow, so it requires a mode that actually has that stage.
    const stageValid = deliveryFilter === 'ALL' ||
      (isDistributionMode(modeFilter) && (STATUS_FLOW[modeFilter] as readonly string[]).includes(deliveryFilter));
    if (!Number.isInteger(currentYear) || currentYear < 2000 || currentYear > 2100 ||
        !['ALL', 'GIVEN', 'NOT_GIVEN'].includes(String(status)) ||
        (modeFilter !== 'ALL' && !isDistributionMode(modeFilter)) || !stageValid ||
        (type && type !== 'ALL' && !isClientType(type)) ||
        (bd && bd !== 'ALL' && !mongoose.Types.ObjectId.isValid(String(bd)))) {
      res.status(400).json({ success: false, message: 'Invalid distribution filters' }); return;
    }
    const associationQuery: any = {};
    if (type && type !== 'ALL') associationQuery.type = type;
    if (bd && bd !== 'ALL') associationQuery.bd = new mongoose.Types.ObjectId(String(bd));
    const associations = await ClientAssociation.find(associationQuery).populate('bd', 'name email').lean();
    const query: any = {};
    const conditions: any[] = [];
    if (Object.keys(associationQuery).length) query._id = { $in: associations.map(row => row.client) };
    if (typeof search === 'string' && search.trim()) {
      const regex = new RegExp(escapeRegex(search.trim()), 'i');
      const bdMatches = associations.filter((row: any) => row.bd && (regex.test(row.bd.name) || regex.test(row.bd.email)));
      query.$or = [{ name: regex }, { mobile: regex }, { normalizedMobile: regex }, { email: regex }, { _id: { $in: bdMatches.map(row => row.client) } }];
    }
    if (status !== 'ALL') {
      const givenIDs = await SweetDistribution.distinct('client', { distributionYear: currentYear, isReverted: { $ne: true } });
      conditions.push({ _id: status === 'GIVEN' ? { $in: givenIDs } : { $nin: givenIDs } });
    }
    if (modeFilter !== 'ALL' || deliveryFilter !== 'ALL') {
      const workflow: any = { distributionYear: currentYear, isReverted: { $ne: true } };
      if (modeFilter !== 'ALL') workflow.mode = modeFilter;
      if (deliveryFilter !== 'ALL') workflow.status = deliveryFilter;
      conditions.push({ _id: { $in: await SweetDistribution.distinct('client', workflow) } });
    }
    if (conditions.length) query.$and = conditions;
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 10));
    const [total, clients] = await Promise.all([
      Client.countDocuments(query),
      Client.find(query).sort({ createdAt: -1, _id: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean(),
    ]);
    const history = await SweetDistribution.find({ client: { $in: clients.map(client => client._id) }, isReverted: { $ne: true } })
      .populate('bd', 'name email').sort({ distributionYear: -1, distributedAt: -1 }).lean();
    const data = clients.map(client => {
      const links = associations.filter(row => String(row.client) === String(client._id));
      const distributions = history.filter(row => String(row.client) === String(client._id));
      const given = distributions.find(row => row.distributionYear === currentYear);
      return {
        _id: client._id, clientId: client._id, associationId: links[0]?._id || null,
        clientName: client.name, clientMobile: client.mobile, clientEmail: client.email || '',
        associations: links.map((row: any) => ({ _id: row._id, type: row.type || null, legacyVertical: row.vertical || null, bd: row.bd })),
        type: links[0]?.type || null, bd: links[0]?.bd || null,
        createdAt: client.createdAt,
        lastGiven: distributions[0]?.distributionYear || null,
        lastGivenDate: distributions[0]?.distributedAt || null,
        isEligible: !given, selectedYear: currentYear,
        currentYearDistribution: given ? { _id: given._id, distributionYear: given.distributionYear, type: given.type || null,
          legacyVertical: given.vertical || null, quantity: given.quantity ?? null, mode: given.mode || null, status: given.status || null, quantityState: quantityState(given.status),
          statusHistory: (given.statusHistory || []).map(entry => ({ status: entry.status, at: entry.at })),
          hasProof: !!given.proof, deliveredAt: given.deliveredAt || null,
          bdId: (given.bd as any)?._id?.toString() || null, bdName: (given.bd as any)?.name || '', bdEmail: (given.bd as any)?.email || '',
          distributedAt: given.distributedAt, notes: given.notes || '' } : null,
      };
    });
    res.status(200).json({ success: true, data, selectedYear: currentYear,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) || 1 } });
  } catch (error: any) {
    console.error('Error fetching distributions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch distribution records' });
  }
};

export const createDistribution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId, year, type, bd, notes, mode } = req.body;

    if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
      res.status(400).json({ success: false, message: 'Valid Client ID is required' });
      return;
    }

    const distributionYear = parseInt(year, 10);
    if (!isRecordableYear(distributionYear)) {
      res.status(400).json({ success: false, message: `Distribution year must be ${FIRST_DIWALI_YEAR} or later.` });
      return;
    }

    if (!isClientType(type)) {
      res.status(400).json({ success: false, message: 'Valid Type is required' });
      return;
    }

    if (!bd || !mongoose.Types.ObjectId.isValid(bd)) {
      res.status(400).json({ success: false, message: 'Valid Requestee Name is required' });
      return;
    }

    if (!isDistributionMode(mode)) {
      res.status(400).json({ success: false, message: `Distribution Mode must be one of: ${DISTRIBUTION_MODES.join(', ')}` });
      return;
    }

    const client = await Client.findById(clientId);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const bdExists = await BD.findById(bd);
    if (!bdExists) {
      res.status(404).json({ success: false, message: 'Requestee not found' });
      return;
    }

    // STRICT CHECK: Has this client ALREADY received sweets for this distribution year (regardless of Type or Requestee)?
    const existingForYear = await SweetDistribution.findOne({
      client: clientId,
      distributionYear,
      isReverted: { $ne: true },
    }).populate('bd', 'name');

    if (existingForYear) {
      const existingBDName = (existingForYear.bd as any)?.name || 'Requestee';
      const formattedDate = new Date(existingForYear.distributedAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      res.status(409).json({
        success: false,
        message: `Client "${client.name}" has already received Diwali sweets for ${distributionYear} (recorded under Type "${existingForYear.type || existingForYear.vertical || 'n/a'}" and Requestee "${existingBDName}" on ${formattedDate}). A client can only receive sweets once per year.`,
      });
      return;
    }

    const association = await ClientAssociation.exists({ client: clientId, type, bd });
    if (!association) {
      res.status(400).json({ success: false, message: 'Link this client to the selected Type and Requestee before recording a distribution.' });
      return;
    }

    // Record the distribution
    const now = new Date();
    const userId = req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined;
    const distribution = await SweetDistribution.create({
      client: clientId,
      distributionYear,
      type,
      bd,
      quantity: DISTRIBUTION_QUANTITY,
      mode,
      status: 'INITIATE',
      statusHistory: [{ status: 'INITIATE', at: now, by: userId }],
      distributedBy: userId,
      notes: notes ? String(notes).trim() : '',
      distributedAt: now,
    });

    res.status(201).json({
      success: true,
      message: `Diwali sweets for ${distributionYear} successfully recorded for "${client.name}".`,
      data: distribution,
    });
  } catch (error: any) {
    console.error('Error creating distribution:', error);
    if (error.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'This client has already received sweets for the selected year. Duplicate entry blocked by database constraint.',
      });
      return;
    }
    res.status(500).json({ success: false, message: 'Failed to record distribution', error: error.message });
  }
};

// Structural JPEG check: SOI, a walk over the marker segments to a start-of-frame with real dimensions and a
// start-of-scan, then EOI. Rejects renamed PNG/PDF/text files and truncated or garbage data.
export const isValidJpeg = (buffer: Buffer): boolean => {
  if (buffer.length < 20 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) return false;
  let offset = 2, frame = false;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return false;
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (marker === 0xd9) return false; // EOI before any scan data
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || buffer.readUInt16BE(offset + 5) === 0 || buffer.readUInt16BE(offset + 7) === 0) return false;
      frame = true;
    }
    if (marker === 0xda) return frame && buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) > offset + 2 + length;
    offset += 2 + length;
  }
  return false;
};

// Moves a distribution one stage forward. Courier: Initiate > Dispatch > Shipping > Delivered. In-person: Initiate > Delivered.
// Courier delivery requires a valid JPEG proof; in-person delivery accepts one optionally.
export const updateDeliveryStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  let proofId: mongoose.Types.ObjectId | null = null;
  let uploadedKey: string | null = null;
  // Removes only what this request created (its proof document and Space object), never pre-existing proofs.
  const discardNewProof = async () => {
    if (proofId) await DeliveryProof.deleteOne({ _id: proofId }).catch(() => undefined);
    if (uploadedKey) await getProofStorage().remove(uploadedKey).catch(error => console.error('Could not remove orphaned proof object:', uploadedKey, error?.message));
    proofId = null; uploadedKey = null;
  };
  try {
    const { id } = req.params;
    const target = req.body?.status as DeliveryStatus;
    if (!mongoose.Types.ObjectId.isValid(id) || !DELIVERY_STATUSES.includes(target)) {
      res.status(400).json({ success: false, message: `A valid status is required (${DELIVERY_STATUSES.join(', ')}).` }); return;
    }
    const distribution = await SweetDistribution.findOne({ _id: id, isReverted: { $ne: true } });
    if (!distribution) { res.status(404).json({ success: false, message: 'Distribution not found or already reverted.' }); return; }
    if (!distribution.mode || !distribution.status) {
      res.status(409).json({ success: false, message: 'This record was created before delivery tracking existed and has no status workflow.' }); return;
    }
    const expected = nextStatus(distribution.mode, distribution.status);
    if (target !== expected) {
      res.status(409).json({ success: false, message: expected
        ? `Invalid transition: ${distribution.status} can only move to ${expected}.`
        : `This ${distribution.mode === 'COURIER' ? 'courier' : 'in-person'} distribution is already ${distribution.status}.` }); return;
    }
    const file = req.file;
    if (target === 'DELIVERED' && distribution.mode === 'COURIER' && !file) {
      res.status(400).json({ success: false, message: 'A JPEG/JPG delivery proof is required to mark a courier distribution as Delivered.' }); return;
    }
    if (file && target !== 'DELIVERED') {
      res.status(400).json({ success: false, message: 'Delivery proof can only be attached when marking Delivered.' }); return;
    }
    if (file) {
      if (!isValidJpeg(file.buffer)) { res.status(400).json({ success: false, message: 'The uploaded file is not a valid JPEG image.' }); return; }
      const storageKey = `proofs/${distribution.distributionYear}/${distribution._id}/${crypto.randomUUID()}.jpg`;
      await getProofStorage().put(storageKey, file.buffer, 'image/jpeg');
      uploadedKey = storageKey;
      const proof = await DeliveryProof.create({
        distribution: distribution._id, originalName: file.originalname.slice(0, 255) || 'proof.jpg', contentType: 'image/jpeg',
        size: file.size, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'), storageKey,
        uploadedBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      });
      proofId = proof._id as mongoose.Types.ObjectId;
    }
    const now = new Date();
    // Compare-and-set on the current stage, so concurrent requests cannot skip or repeat a transition.
    const updated = await SweetDistribution.findOneAndUpdate(
      { _id: id, isReverted: { $ne: true }, status: distribution.status },
      { $set: { status: target, ...(target === 'DELIVERED' ? { deliveredAt: now } : {}), ...(proofId ? { proof: proofId } : {}) },
        $push: { statusHistory: { status: target, at: now, by: req.user?.id } } },
      { new: true });
    if (!updated) {
      await discardNewProof();
      res.status(409).json({ success: false, message: 'This distribution was changed by someone else. Refresh and try again.' }); return;
    }
    res.status(200).json({ success: true, message: `Status updated to ${target}.`,
      data: { _id: updated._id, status: updated.status, mode: updated.mode, hasProof: !!updated.proof, deliveredAt: updated.deliveredAt,
        statusHistory: updated.statusHistory.map(entry => ({ status: entry.status, at: entry.at })) } });
  } catch (error: any) {
    console.error('Error updating delivery status:', error);
    await discardNewProof();
    res.status(500).json({ success: false, message: 'Unable to update delivery status.' });
  }
};

// Authenticated read of a delivery proof (never served from a public/static path).
export const getDeliveryProof = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400).json({ success: false, message: 'Invalid distribution ID' }); return; }
    const distribution = await SweetDistribution.findById(id).select('proof').lean();
    const proof = distribution?.proof ? await DeliveryProof.findById(distribution.proof) : null;
    if (!proof) { res.status(404).json({ success: false, message: 'No delivery proof on file.' }); return; }
    const headers = { 'Content-Type': proof.contentType, 'Content-Disposition': 'inline; filename="delivery-proof.jpg"',
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    if (proof.storageKey) {
      // Private Space object: streamed through this authenticated route; the bucket is never public.
      const object = await getProofStorage().get(proof.storageKey);
      res.set({ ...headers, 'Content-Length': String(proof.size) }); res.status(200);
      object.stream.on('error', () => res.destroy());
      object.stream.pipe(res);
      return;
    }
    // Legacy proof: image bytes still stored in MongoDB.
    if (!proof.data) { res.status(404).json({ success: false, message: 'No delivery proof on file.' }); return; }
    res.set({ ...headers, 'Content-Length': String(proof.data.length) });
    res.status(200).send(proof.data);
  } catch (error) {
    console.error('Error reading delivery proof:', error);
    res.status(500).json({ success: false, message: 'Unable to read delivery proof.' });
  }
};

// Reverting preserves the original record and notes for audit; only its eligibility effect is reversed.
export const revertDistribution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
    if (!mongoose.Types.ObjectId.isValid(id) || reason.length < 5 || reason.length > 1000) {
      res.status(400).json({ success: false, message: 'A valid distribution and a reason of 5 to 1000 characters are required.' }); return;
    }
    const reverted = await SweetDistribution.findOneAndUpdate({ _id: id, isReverted: { $ne: true } },
      { $set: { isReverted: true, revertedAt: new Date(), revertedBy: req.user!.id, revertReason: reason } }, { new: true, runValidators: true });
    if (!reverted) {
      res.status(404).json({ success: false, message: 'Distribution not found or already reverted.' }); return;
    }
    res.status(200).json({ success: true, message: 'Distribution reverted. The client is eligible again for that year.' });
  } catch (error) {
    console.error('Error reverting distribution:', error);
    res.status(500).json({ success: false, message: 'Unable to revert distribution.' });
  }
};
