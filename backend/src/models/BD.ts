import mongoose, { Document, Schema } from 'mongoose';

export interface IBD extends Document {
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

const BDSchema = new Schema<IBD>(
  {
    name: {
      type: String,
      required: [true, 'BD Name is required'],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const BD = mongoose.model<IBD>('BD', BDSchema);

