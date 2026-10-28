import mongoose, { Document, Schema } from 'mongoose';

// Delivery proof images live in MongoDB (not on the app server's disk) so they survive redeploys and
// restarts on hosts with ephemeral filesystems. Reads go through an authenticated API route only.
export interface IDeliveryProof extends Document {
  distribution: mongoose.Types.ObjectId;
  originalName: string;
  contentType: 'image/jpeg';
  size: number;
  sha256: string;
  data: Buffer;
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
    data: { type: Buffer, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const DeliveryProof = mongoose.model<IDeliveryProof>('DeliveryProof', DeliveryProofSchema);
