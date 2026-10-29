import mongoose, { Document, Schema } from 'mongoose';
import { DEFAULT_OCCASIONS, normalizeOccasionName } from '../config/occasions.js';

export interface IOccasion extends Document {
  name: string;
  /** Lower-cased name; the unique key that makes duplicates case-insensitive. */
  normalizedName: string;
  isDefault: boolean;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const OccasionSchema = new Schema<IOccasion>(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    normalizedName: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  // Indexes are managed only by ensureOccasions(). Mongoose's automatic build would try to create `normalizedName_1`
  // and fail with IndexOptionsConflict (code 85) on a database that already holds the same index under another name.
  { timestamps: { createdAt: true, updatedAt: false }, autoIndex: false }
);

OccasionSchema.index({ normalizedName: 1 }, { unique: true });

export const Occasion = mongoose.model<IOccasion>('Occasion', OccasionSchema);

const isNormalizedNameKey = (key: Record<string, unknown>) => Object.keys(key).length === 1 && key.normalizedName === 1;

// Idempotent: guarantees a unique index on normalizedName (whatever it is called) and adds any missing default occasion.
// Existing occasions are never changed or removed, and no index is dropped unless it is a non-unique index on the same key
// that has to be replaced, which is only done when there are no duplicate names.
export const ensureOccasions = async (): Promise<void> => {
  await Occasion.createCollection();
  const sameKey = (await Occasion.collection.indexes()).filter(index => isNormalizedNameKey(index.key));
  if (!sameKey.some(index => index.unique)) {
    for (const index of sameKey) {
      const duplicates = await Occasion.aggregate([{ $group: { _id: '$normalizedName', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 1 }]);
      if (duplicates.length) throw new Error(`Cannot make index "${index.name}" unique: duplicate occasion names exist. Resolve them manually.`);
      await Occasion.collection.dropIndex(index.name!);
    }
    await Occasion.collection.createIndex({ normalizedName: 1 }, { unique: true });
  }
  for (const name of DEFAULT_OCCASIONS) {
    await Occasion.updateOne({ normalizedName: normalizeOccasionName(name) }, { $setOnInsert: { name, normalizedName: normalizeOccasionName(name), isDefault: true } }, { upsert: true });
  }
};

/** Canonical stored name for a user-supplied occasion (case-insensitive), or null when it does not exist. */
export const findOccasionName = async (raw: unknown): Promise<string | null> => {
  const clean = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!clean) return null;
  const found = await Occasion.findOne({ normalizedName: normalizeOccasionName(clean) }).lean();
  return found?.name ?? null;
};
