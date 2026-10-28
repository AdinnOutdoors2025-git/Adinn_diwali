import mongoose, { Document, Schema } from 'mongoose';
import { MAX_ALLOWED_QUANTITY } from '../config/distribution.js';

export interface IClient extends Document {
  name: string;
  normalizedName: string;
  mobile: string;
  normalizedMobile: string;
  email?: string;
  allowedQuantity: number;
  createdAt: Date;
  updatedAt: Date;
}

const ClientSchema = new Schema<IClient>(
  {
    name: {
      type: String,
      required: [true, 'Client/Vendor name is required'],
      trim: true,
      index: true,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      trim: true,
      index: true,
    },
    normalizedMobile: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    allowedQuantity: {
      type: Number,
      default: 1,
      min: [1, 'Allowed Quantity must be at least 1'],
      max: [MAX_ALLOWED_QUANTITY, `Allowed Quantity cannot exceed ${MAX_ALLOWED_QUANTITY}`],
      validate: { validator: Number.isInteger, message: 'Allowed Quantity must be a whole number' },
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to quickly look up existing client identities by normalized mobile and name
ClientSchema.index({ normalizedMobile: 1, normalizedName: 1 });
ClientSchema.index({ normalizedMobile: 1 }, { unique: true, name: 'normalized_mobile_unique' });
ClientSchema.index({ normalizedName: 1 }, { unique: true, name: 'normalized_name_unique' });

export const Client = mongoose.model<IClient>('Client', ClientSchema);

// Fail rather than merge/delete existing data if legacy identities conflict.
export const ensureClientIndexes = async (): Promise<void> => {
  await Client.createCollection();
  await Client.collection.createIndex({ normalizedMobile: 1 }, { unique: true, name: 'normalized_mobile_unique' });
  await Client.collection.createIndex({ normalizedName: 1 }, { unique: true, name: 'normalized_name_unique' });
  // Existing clients predate Allowed Quantity: give them the default of 1 (idempotent, no other change).
  await Client.updateMany({ allowedQuantity: { $exists: false } }, { $set: { allowedQuantity: 1 } }, { timestamps: false });
};

