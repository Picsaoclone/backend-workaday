import mongoose, { Document, Schema } from "mongoose";

export type FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

export interface IFriendRequest extends Document {
  requesterId: string;
  recipientId: string;
  status: FriendRequestStatus;
  respondedAt?: Date;
}

const FriendRequestSchema = new Schema<IFriendRequest>(
  {
    requesterId: { type: String, required: true, index: true },
    recipientId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    respondedAt: { type: Date },
  },
  { timestamps: true }
);

// Prevent duplicate accepted/pending relationships.
FriendRequestSchema.index(
  { requesterId: 1, recipientId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "accepted"] } } }
);

export default mongoose.model<IFriendRequest>("FriendRequest", FriendRequestSchema);
