import crypto from 'node:crypto';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { SweetDistribution } from '../models/SweetDistribution.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { ClientAssociation } from '../models/ClientAssociation.js';
import { Client } from '../models/Client.js';
import { BD } from '../models/BD.js';
import { findOccasionName } from '../models/Occasion.js';
import { LEGACY_OCCASION, occasionMatch } from '../config/occasions.js';
import { AuthRequest } from '../middleware/auth.js';
import { getProofStorage } from '../config/proofStorage.js';
import { FIRST_DIWALI_YEAR, isRecordableYear } from '../config/diwaliYear.js';
import {
  DELIVERY_STATUSES, DeliveryStatus, DISTRIBUTION_MODES, STATUS_FLOW, isClientType, isDistributionMode, nextStatus, quantityState, MIN_ADDRESS_LENGTH, MAX_ADDRESS_LENGTH,
} from '../config/distribution.js';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getDistributionRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const { year, type, bd, search, status = 'ALL', mode = 'ALL', deliveryStatus = 'ALL', page = '1', limit = '10', occasion: occasionParam } = req.query;
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
    // No occasion means Diwali (the original behaviour); an unknown one is rejected rather than silently showing nothing.
    const occasion = occasionParam ? await findOccasionName(occasionParam) : LEGACY_OCCASION;
    if (!occasion) { res.status(400).json({ success: false, message: 'Unknown occasion' }); return; }
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
      const givenIDs = await SweetDistribution.distinct('client', { distributionYear: currentYear, occasion: occasionMatch(occasion), isReverted: { $ne: true } });
      conditions.push({ _id: status === 'GIVEN' ? { $in: givenIDs } : { $nin: givenIDs } });
    }
    if (modeFilter !== 'ALL' || deliveryFilter !== 'ALL') {
      const workflow: any = { distributionYear: currentYear, occasion: occasionMatch(occasion), isReverted: { $ne: true } };
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
    const history = await SweetDistribution.find({ client: { $in: clients.map(client => client._id) }, occasion: occasionMatch(occasion), isReverted: { $ne: true } })
      .populate('bd', 'name email').sort({ distributionYear: -1, distributedAt: -1 }).lean();
    // Reverted records stay in the collection (a revert never deletes), so a client reverted several times has one entry per revert.
    // Entries are scoped to the selected occasion and year; the timestamp and reason were written by the server when the revert succeeded.
    const reverts = await SweetDistribution.find({ client: { $in: clients.map(client => client._id) }, occasion: occasionMatch(occasion), distributionYear: currentYear, isReverted: true })
      .select('client revertedAt revertReason distributedAt mode status quantity').sort({ revertedAt: -1, _id: -1 }).lean();
    const data = clients.map(client => {
      const links = associations.filter(row => String(row.client) === String(client._id));
      const distributions = history.filter(row => String(row.client) === String(client._id));
      const given = distributions.find(row => row.distributionYear === currentYear);
      return {
        _id: client._id, clientId: client._id, associationId: links[0]?._id || null,
        clientName: client.name, clientMobile: client.mobile, clientEmail: client.email || '', clientQuantity: client.quantity ?? null,
        associations: links.map((row: any) => ({ _id: row._id, type: row.type || null, legacyVertical: row.vertical || null, bd: row.bd })),
        type: links[0]?.type || null, bd: links[0]?.bd || null,
        createdAt: client.createdAt,
        lastGiven: distributions[0]?.distributionYear || null,
        lastGivenDate: distributions[0]?.distributedAt || null,
        revertHistory: reverts.filter(row => String(row.client) === String(client._id)).map(row => ({
          _id: row._id, revertedAt: row.revertedAt || null, reason: row.revertReason || null, distributedAt: row.distributedAt || null,
          mode: row.mode || null, status: row.status || null, quantity: row.quantity ?? null })),
        isEligible: !given, selectedYear: currentYear,
        currentYearDistribution: given ? { _id: given._id, distributionYear: given.distributionYear, occasion: given.occasion || LEGACY_OCCASION, type: given.type || null,
          legacyVertical: given.vertical || null, quantity: given.quantity ?? null, mode: given.mode || null, status: given.status || null, quantityState: quantityState(given.status),
          statusHistory: (given.statusHistory || []).map(entry => ({ status: entry.status, at: entry.at })),
          hasProof: !!given.proof, deliveredAt: given.deliveredAt || null, address: given.mode === 'COURIER' ? given.address || null : null,
          bdId: (given.bd as any)?._id?.toString() || null, bdName: (given.bd as any)?.name || '', bdEmail: (given.bd as any)?.email || '',
          distributedAt: given.distributedAt, notes: given.notes || '' } : null,
      };
    });
    res.status(200).json({ success: true, data, selectedYear: currentYear, selectedOccasion: occasion,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) || 1 } });
  } catch (error: any) {
    console.error('Error fetching distributions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch distribution records' });
  }
};

// Live totals for the Home dashboard, computed in the database for one occasion and year.
// - Total Entries: unique registered clients, whether or not anything has been distributed. Clients are not tied to an occasion, so
//   this is every client registered by the end of the selected year, plus any client that has a distribution in that occasion and year.
// - Delivered / Pending: the client's active (not reverted) distribution for that occasion and year. Delivered = status DELIVERED, or an
//   older record with no status, which the app treats as given; Pending = every other stage. Reverted records are never counted.
// - Total Quantity: the quantity saved on each of those clients (falling back to the distribution's own for older clients without one).
export const getDistributionAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { res.status(400).json({ success: false, message: 'Valid year is required' }); return; }
    const occasion = req.query.occasion ? await findOccasionName(req.query.occasion) : LEGACY_OCCASION;
    if (!occasion) { res.status(400).json({ success: false, message: 'Unknown occasion' }); return; }
    const hasDist = { $ne: [{ $type: '$dist' }, 'missing'] };
    const isDelivered = { $eq: [{ $ifNull: ['$dist.status', 'DELIVERED'] }, 'DELIVERED'] };
    const distQty = { $ifNull: ['$dist.quantity', 0] };
    const [totals] = await Client.aggregate([
      { $lookup: {
        from: SweetDistribution.collection.name,
        let: { id: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$client', '$$id'] }, distributionYear: year, occasion: occasionMatch(occasion), isReverted: { $ne: true } } },
          { $sort: { distributedAt: -1, _id: -1 } },
          { $limit: 1 },
          { $project: { status: 1, quantity: 1 } },
        ],
        as: 'dist',
      } },
      { $addFields: { dist: { $arrayElemAt: ['$dist', 0] } } },
      { $match: { $or: [{ createdAt: { $lt: new Date(Date.UTC(year + 1, 0, 1)) } }, { $expr: hasDist }] } },
      { $group: {
        _id: null,
        totalEntries: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $and: [hasDist, isDelivered] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $and: [hasDist, { $not: [isDelivered] }] }, 1, 0] } },
        totalQuantity: { $sum: { $ifNull: ['$quantity', distQty] } },
        deliveredQuantity: { $sum: { $cond: [{ $and: [hasDist, isDelivered] }, distQty, 0] } },
        pendingQuantity: { $sum: { $cond: [{ $and: [hasDist, { $not: [isDelivered] }] }, distQty, 0] } },
      } },
    ]);
    const t = totals || { totalEntries: 0, delivered: 0, pending: 0, totalQuantity: 0, deliveredQuantity: 0, pendingQuantity: 0 };
    res.status(200).json({ success: true, data: {
      year, occasion, totalEntries: t.totalEntries, delivered: t.delivered, pending: t.pending,
      totalQuantity: t.totalQuantity, deliveredQuantity: t.deliveredQuantity, pendingQuantity: t.pendingQuantity,
      generatedAt: new Date().toISOString(),
    } });
  } catch (error: any) {
    console.error('Error computing distribution analytics:', error);
    res.status(500).json({ success: false, message: 'Failed to load analytics' });
  }
};

export const createDistribution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { clientId, year, type, bd, notes, mode } = req.body;
    // No occasion in the request means Diwali, so existing callers keep working. An unknown occasion is rejected.
    const occasion = req.body.occasion === undefined || req.body.occasion === '' ? LEGACY_OCCASION : await findOccasionName(req.body.occasion);
    if (!occasion) {
      res.status(400).json({ success: false, message: 'Select a valid occasion.' });
      return;
    }
    const address = typeof req.body.address === 'string' ? req.body.address.trim().replace(/[ \t]+/g, ' ') : '';

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

    // A courier shipment cannot be sent without somewhere to send it. In-person distributions do not carry an address.
    if (mode === 'COURIER' && (address.length < MIN_ADDRESS_LENGTH || address.length > MAX_ADDRESS_LENGTH)) {
      res.status(400).json({ success: false, message: `Delivery address is required for Courier (${MIN_ADDRESS_LENGTH} to ${MAX_ADDRESS_LENGTH} characters).` });
      return;
    }

    const client = await Client.findById(clientId);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    // The quantity is the one saved on the client; it is never taken from this request.
    const quantity = client.quantity;
    if (!quantity || quantity < 1) {
      res.status(400).json({ success: false, message: `"${client.name}" has no quantity yet. Edit the client and set a quantity above 0 before recording a distribution.` });
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
      occasion: occasionMatch(occasion),
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
        message: `Client "${client.name}" has already received ${occasion} sweets for ${distributionYear} (recorded under Type "${existingForYear.type || existingForYear.vertical || 'n/a'}" and Requestee "${existingBDName}" on ${formattedDate}). A client can only receive sweets once per occasion per year.`,
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
      occasion,
      type,
      bd,
      quantity,
      mode,
      ...(mode === 'COURIER' ? { address } : {}),
      status: 'INITIATE',
      statusHistory: [{ status: 'INITIATE', at: now, by: userId }],
      distributedBy: userId,
      notes: notes ? String(notes).trim() : '',
      distributedAt: now,
    });

    res.status(201).json({
      success: true,
      message: `${occasion} sweets for ${distributionYear} successfully recorded for "${client.name}".`,
      data: distribution,
    });
  } catch (error: any) {
    console.error('Error creating distribution:', error);
    if (error.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'This client has already received sweets for the selected occasion and year. Duplicate entry blocked by database constraint.',
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

// Authenticated lookup of the direct Space object URL for a proof (derived from the stored key; never stored itself).
// Legacy MongoDB-binary proofs have no object, so the client falls back to the streaming /proof route.
export const getDeliveryProofUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400).json({ success: false, message: 'Invalid distribution ID' }); return; }
    const distribution = await SweetDistribution.findById(id).select('proof').lean();
    const proof = distribution?.proof ? await DeliveryProof.findById(distribution.proof).select('-data') : null;
    if (!proof) { res.status(404).json({ success: false, message: 'No delivery proof on file.' }); return; }
    res.set('Cache-Control', 'private, no-store');
    if (!proof.storageKey) { res.status(200).json({ success: true, data: { source: 'MONGODB', url: null } }); return; }
    res.status(200).json({ success: true, data: { source: 'SPACES', url: getProofStorage().publicUrl(proof.storageKey) } });
  } catch (error) {
    console.error('Error creating delivery proof URL:', error);
    res.status(500).json({ success: false, message: 'Unable to prepare the delivery proof link.' });
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
