import mongoose, { Document, Schema } from 'mongoose';

export const VALID_VERTICALS = [
  'Roadshow',
  'Outdoor',
  'Signage',
  'Media & Arts',
  'POPs & Offsets',
  'Fixtures',
  'Events & Activation',
  'Digital Marketing',
  'Software Development',
  'Wall Painting',
] as const;

export type VerticalType = typeof VALID_VERTICALS[number];

export interface IClientAssociation extends Document {
  client: mongoose.Types.ObjectId;
  vertical: VerticalType;
  bd: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ClientAssociationSchema = new Schema<IClientAssociation>(
  {
    client: {
      type: Schema.Types.ObjectId,
      ref: 'Client',
      required: [true, 'Client reference is required'],
      index: true,
    },
    vertical: {
      type: String,
      required: [true, 'Vertical is required'],
      enum: {
        values: VALID_VERTICALS,
        message: '{VALUE} is not a valid vertical',
      },
      index: true,
    },
    bd: {
      type: Schema.Types.ObjectId,
      ref: 'BD',
      required: [true, 'Business Developer (BD) is required'],
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index: a client can only be associated once with the same Vertical and BD
ClientAssociationSchema.index({ client: 1, vertical: 1, bd: 1 }, { unique: true });
// Index for fast filtering by vertical and BD
ClientAssociationSchema.index({ vertical: 1, bd: 1 });

export const ClientAssociation = mongoose.model<IClientAssociation>(
  'ClientAssociation',
  ClientAssociationSchema
);

