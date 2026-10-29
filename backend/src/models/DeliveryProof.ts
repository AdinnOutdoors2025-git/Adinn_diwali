import mongoose, { Document, Schema } from 'mongoose';

// New proofs are stored in a DigitalOcean Space (public-read objects): only the object key and metadata are kept here.
// Legacy proofs (no storageKey) still hold their image bytes in `data` and stay readable.
// Reads go through an authenticated API route only.
export interface IDeliveryProof extends Document {
  distribution: mongoose.Types.ObjectId;
  originalName: string;
  contentType: 'image/jpeg';
  size: number;
  sha256: string;
  data?: Buffer;
  storageKey?: string;
  uploadedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const DeliveryProofSchema = new Schema<IDeliveryProof>(
  {
    distribution: { type: Schema.Types.ObjectId, ref: 'SweetDistribution', required: true, index: true },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    contentType: { type: String, enum: ['image/jpeg'], required: true },
    size: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true },
    data: { type: Buffer, required: function (this: IDeliveryProof) { return !this.storageKey; } },
    storageKey: { type: String, trim: true, maxlength: 512 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const DeliveryProof = mongoose.model<IDeliveryProof>('DeliveryProof', DeliveryProofSchema);
