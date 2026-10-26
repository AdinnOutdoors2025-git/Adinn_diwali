import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { SweetDistribution } from '../models/SweetDistribution.js';
import { ClientAssociation, VALID_VERTICALS, VerticalType } from '../models/ClientAssociation.js';
import { Client } from '../models/Client.js';
import { BD } from '../models/BD.js';
import { AuthRequest } from '../middleware/auth.js';
import { FIRST_DIWALI_YEAR, isRecordableYear } from '../config/diwaliYear.js';

export const getDistributionRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const { year, vertical, bd, search, status = 'ALL', page = '1', limit = '10' } = req.query;
    const currentYear = Number(year || new Date().getFullYear());
    if (!Number.isInteger(currentYear) || currentYear < 2000 || currentYear > 2100 ||
        !['ALL', 'GIVEN', 'NOT_GIVEN'].includes(String(status)) ||
        (vertical && vertical !== 'ALL' && !VALID_VERTICALS.includes(vertical as VerticalType)) ||
        (bd && bd !== 'ALL' && !mongoose.Types.ObjectId.isValid(String(bd)))) {
      res.status(400).json({ success: false, message: 'Invalid distribution filters' }); return;
    }
    const associationQuery: any = {};
    if (vertical && vertical !== 'ALL') associationQuery.vertical = vertical;
    if (bd && bd !== 'ALL') associationQuery.bd = new mongoose.Types.ObjectId(String(bd));
    const associations = await ClientAssociation.find(associationQuery).populate('bd', 'name email').lean();
    const query: any = {};
    if (Object.keys(associationQuery).length) query._id = { $in: associations.map(row => row.client) };
    if (typeof search === 'string' && search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const bdMatches = associations.filter((row: any) => row.bd && (regex.test(row.bd.name) || regex.test(row.bd.email)));
      query.$or = [{ name: regex }, { mobile: regex }, { normalizedMobile: regex }, { email: regex }, { _id: { $in: bdMatches.map(row => row.client) } }];
    }
    if (status !== 'ALL') {
      const givenIDs = await SweetDistribution.distinct('client', { distributionYear: currentYear, isReverted: { $ne: true } });
      query.$and = [{ _id: status === 'GIVEN' ? { $in: givenIDs } : { $nin: givenIDs } }];
    }
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
        associations: links.map((row: any) => ({ _id: row._id, vertical: row.vertical, bd: row.bd })),
        vertical: links[0]?.vertical || null, bd: links[0]?.bd || null,
        createdAt: client.createdAt,
        lastGiven: distributions[0]?.distributionYear || null,
        lastGivenDate: distributions[0]?.distributedAt || null,
        isEligible: !given, selectedYear: currentYear,
        currentYearDistribution: given ? { _id: given._id, distributionYear: given.distributionYear, vertical: given.vertical,
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
    const { clientId, year, vertical, bd, notes } = req.body;

    if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
      res.status(400).json({ success: false, message: 'Valid Client ID is required' });
      return;
    }

    const distributionYear = parseInt(year, 10);
    if (!isRecordableYear(distributionYear)) {
      res.status(400).json({ success: false, message: `Distribution year must be ${FIRST_DIWALI_YEAR} or later.` });
      return;
    }

    if (!vertical || !VALID_VERTICALS.includes(vertical)) {
      res.status(400).json({ success: false, message: 'Valid Vertical is required' });
      return;
    }

    if (!bd || !mongoose.Types.ObjectId.isValid(bd)) {
      res.status(400).json({ success: false, message: 'Valid BD is required' });
      return;
    }

    const client = await Client.findById(clientId);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const bdExists = await BD.findById(bd);
    if (!bdExists) {
      res.status(404).json({ success: false, message: 'BD not found' });
      return;
    }

    // STRICT CHECK: Has this client ALREADY received sweets for this distribution year (regardless of Vertical or BD)?
    const existingForYear = await SweetDistribution.findOne({
      client: clientId,
      distributionYear,
      isReverted: { $ne: true },
    }).populate('bd', 'name');

    if (existingForYear) {
      const existingBDName = (existingForYear.bd as any)?.name || 'BD';
      const formattedDate = new Date(existingForYear.distributedAt).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      res.status(409).json({
        success: false,
        message: `Client "${client.name}" has already received Diwali sweets for ${distributionYear} (recorded under Vertical "${existingForYear.vertical}" and BD "${existingBDName}" on ${formattedDate}). A client can only receive sweets once per year.`,
      });
      return;
    }

    const association = await ClientAssociation.exists({ client: clientId, vertical, bd });
    if (!association) {
      res.status(400).json({ success: false, message: 'Link this client to the selected Vertical and BD before recording a distribution.' });
      return;
    }

    // Record the distribution
    const distribution = await SweetDistribution.create({
      client: clientId,
      distributionYear,
      vertical,
      bd,
      distributedBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined,
      notes: notes ? String(notes).trim() : '',
      distributedAt: new Date(),
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
