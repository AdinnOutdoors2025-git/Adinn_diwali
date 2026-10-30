import mongoose, { Document, Schema } from 'mongoose';

export interface IClient extends Document {
  name: string;
  normalizedName: string;
  mobile: string;
  normalizedMobile: string;
  email?: string;
  /** Sweets to give this client; entered when the client is added. Absent on records created before it existed. */
  quantity?: number;
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
    quantity: { type: Number, min: 1, validate: { validator: Number.isInteger, message: 'Quantity must be a whole number' } },
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
};

