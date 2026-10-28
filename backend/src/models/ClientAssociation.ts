import mongoose, { Document, Schema } from 'mongoose';
import { CLIENT_TYPES, ClientType } from '../config/distribution.js';

export interface IClientAssociation extends Document {
  client: mongoose.Types.ObjectId;
  type?: ClientType;
  /** Pre-Type "Vertical" value. Preserved as-is for existing records; never written for new ones. */
  vertical?: string;
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
    // Optional at the schema level only so pre-existing records stay valid; the API requires it for new ones.
    type: {
      type: String,
      enum: { values: CLIENT_TYPES, message: '{VALUE} is not a valid type' },
      index: true,
    },
    vertical: { type: String },
    bd: {
      type: Schema.Types.ObjectId,
      ref: 'BD',
      required: [true, 'Requestee (BD) is required'],
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

ClientAssociationSchema.index({ type: 1, bd: 1 });

export const ClientAssociation = mongoose.model<IClientAssociation>(
  'ClientAssociation',
  ClientAssociationSchema
);

// A client can only be associated once with the same Type and Requestee. The legacy Vertical index is
// dropped because new records carry no vertical; records without a Type are outside the unique rule.
export const ensureAssociationIndexes = async (): Promise<void> => {
  await ClientAssociation.createCollection();
  const indexes = await ClientAssociation.collection.indexes();
  for (const index of indexes) {
    if (index.unique && index.key.vertical === 1 && index.key.client === 1 && index.key.bd === 1) {
      await ClientAssociation.collection.dropIndex(index.name!);
    }
  }
  await ClientAssociation.collection.createIndex({ client: 1, type: 1, bd: 1 }, {
    unique: true, name: 'client_type_bd_unique', partialFilterExpression: { type: { $type: 'string' } },
  });
};
