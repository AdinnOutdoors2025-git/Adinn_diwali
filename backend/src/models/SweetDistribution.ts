import mongoose, { Document, Schema } from 'mongoose';
import { VALID_VERTICALS, VerticalType } from './ClientAssociation.js';

export interface ISweetDistribution extends Document {
  client: mongoose.Types.ObjectId;
  distributionYear: number;
  vertical: VerticalType;
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
    vertical: {
      type: String,
      required: [true, 'Vertical is required'],
      enum: {
        values: VALID_VERTICALS,
        message: '{VALUE} is not a valid vertical',
      },
    },
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

// Enforce strict uniqueness: A client can receive sweets ONLY ONCE per year across all Verticals and BDs
SweetDistributionSchema.index({ client: 1, distributionYear: 1 }, {
  unique: true, name: 'active_client_year_unique', partialFilterExpression: { isReverted: false },
});
// Index for year + vertical + bd filtering
SweetDistributionSchema.index({ distributionYear: 1, vertical: 1, bd: 1 });

export const SweetDistribution = mongoose.model<ISweetDistribution>(
  'SweetDistribution',
  SweetDistributionSchema
);

// Keep annual uniqueness enforced while retaining reverted records in the same collection.
export const ensureDistributionIndexes = async (): Promise<void> => {
  await SweetDistribution.createCollection();
  await SweetDistribution.updateMany({ isReverted: { $exists: false } }, { $set: { isReverted: false } }, { timestamps: false });
  await SweetDistribution.collection.createIndex({ client: 1, distributionYear: 1 }, {
    unique: true, name: 'active_client_year_unique', partialFilterExpression: { isReverted: false },
  });
  const indexes = await SweetDistribution.collection.indexes();
  for (const index of indexes) {
    if (index.unique && !index.partialFilterExpression && index.key.client === 1 && index.key.distributionYear === 1 && Object.keys(index.key).length === 2) {
      await SweetDistribution.collection.dropIndex(index.name!);
    }
  }
};

