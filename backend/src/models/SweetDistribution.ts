import mongoose, { Document, Schema } from 'mongoose';
import { CLIENT_TYPES, ClientType, DELIVERY_STATUSES, DeliveryStatus, DISTRIBUTION_MODES, DistributionMode } from '../config/distribution.js';
import { LEGACY_OCCASION } from '../config/occasions.js';

export interface ISweetDistribution extends Document {
  client: mongoose.Types.ObjectId;
  distributionYear: number;
  /** Festival/occasion this distribution is for. Records created before occasions existed have none and are Diwali. */
  occasion?: string;
  type?: ClientType;
  /** Pre-Type "Vertical" value, preserved for records created before Type existed. */
  vertical?: string;
  quantity?: number;
  mode?: DistributionMode;
  status?: DeliveryStatus;
  statusHistory: { status: DeliveryStatus; at: Date; by?: mongoose.Types.ObjectId }[];
  proof?: mongoose.Types.ObjectId;
  deliveredAt?: Date;
  /** Delivery address; required for Courier distributions, absent for In-person and legacy records. */
  address?: string;
  bd: mongoose.Types.ObjectId;
  distributedAt: Date;
  distributedBy?: mongoose.Types.ObjectId;
  notes?: string;
  isReverted: boolean;
  revertedAt?: Date;
  revertedBy?: mongoose.Types.ObjectId;
  revertReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SweetDistributionSchema = new Schema<ISweetDistribution>(
  {
    client: {
      type: Schema.Types.ObjectId,
      ref: 'Client',
      required: [true, 'Client reference is required'],
      index: true,
    },
    distributionYear: {
      type: Number,
      required: [true, 'Distribution year is required'],
      index: true,
    },
    occasion: { type: String, trim: true, maxlength: 50 },
    // quantity/mode/status are required by the API for new records; they are absent on pre-existing ones.
    type: { type: String, enum: { values: CLIENT_TYPES, message: '{VALUE} is not a valid type' } },
    vertical: { type: String },
    quantity: { type: Number, min: 1, validate: { validator: Number.isInteger, message: 'Quantity must be a whole number' } },
    mode: { type: String, enum: { values: DISTRIBUTION_MODES, message: '{VALUE} is not a valid mode' } },
    status: { type: String, enum: { values: DELIVERY_STATUSES, message: '{VALUE} is not a valid status' } },
    statusHistory: {
      type: [{
        _id: false,
        status: { type: String, enum: DELIVERY_STATUSES, required: true },
        at: { type: Date, required: true },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
      }],
      default: [],
    },
    proof: { type: Schema.Types.ObjectId, ref: 'DeliveryProof' },
    address: { type: String, trim: true, maxlength: [500, 'Address must be 500 characters or fewer'] },
    deliveredAt: Date,
    bd: {
      type: Schema.Types.ObjectId,
      ref: 'BD',
      required: [true, 'Business Developer (BD) is required'],
      index: true,
    },
    distributedAt: {
      type: Date,
      default: Date.now,
    },
    distributedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    isReverted: { type: Boolean, default: false, required: true },
    revertedAt: Date,
    revertedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revertReason: { type: String, trim: true, maxlength: 1000 },
  },
  {
    timestamps: true,
  }
);

// Enforce strict uniqueness: a client can receive sweets ONLY ONCE per occasion per year across all Types and Requestees
SweetDistributionSchema.index({ client: 1, distributionYear: 1, occasion: 1 }, {
  unique: true, name: 'active_client_year_occasion_unique', partialFilterExpression: { isReverted: false },
});
// Indexes for year + type + requestee and year + mode + status filtering
SweetDistributionSchema.index({ distributionYear: 1, type: 1, bd: 1 });
SweetDistributionSchema.index({ distributionYear: 1, mode: 1, status: 1 });

export const SweetDistribution = mongoose.model<ISweetDistribution>(
  'SweetDistribution',
  SweetDistributionSchema
);

// Keep annual uniqueness enforced while retaining reverted records in the same collection.
export const ensureDistributionIndexes = async (): Promise<void> => {
  await SweetDistribution.createCollection();
  await SweetDistribution.updateMany({ isReverted: { $exists: false } }, { $set: { isReverted: false } }, { timestamps: false });
  // Occasions arrived after the first records: tag every untagged record as Diwali (additive, idempotent) so the
  // per-occasion unique index below treats old and new Diwali records identically.
  await SweetDistribution.updateMany({ occasion: { $exists: false } }, { $set: { occasion: LEGACY_OCCASION } }, { timestamps: false });
  await SweetDistribution.collection.createIndex({ client: 1, distributionYear: 1, occasion: 1 }, {
    unique: true, name: 'active_client_year_occasion_unique', partialFilterExpression: { isReverted: false },
  });
  // The old one-per-year unique indexes would block a second occasion in the same year, so they are replaced by the one above.
  const indexes = await SweetDistribution.collection.indexes();
  for (const index of indexes) {
    const yearOnly = Object.keys(index.key).length === 2 && index.key.client === 1 && index.key.distributionYear === 1;
    if (yearOnly && index.unique) await SweetDistribution.collection.dropIndex(index.name!);
  }
};

