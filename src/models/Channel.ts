import mongoose, { Schema, Document } from "mongoose";

export interface IChannel extends Document {
  companyId: string;
  name: string;
  description?: string;
  type: "public" | "private" | "dm";
  memberIds: string[];
  adminIds: string[];
  dmUserIds?: [string, string];
  isPinned?: boolean;
  lastMessageAt?: Date;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  lastMessageType?: "text" | "image" | "file" | "system";
  createdBy: string;
}

const ChannelSchema = new Schema<IChannel>(
  {
    companyId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    type: { type: String, enum: ["public", "private", "dm"], default: "public" },
    memberIds: { type: [String], default: [] },
    adminIds: { type: [String], default: [] },
    dmUserIds: { type: [String] },
    isPinned: { type: Boolean, default: false },
    lastMessageAt: { type: Date },
    lastMessageText: { type: String },
    lastMessageSenderId: { type: String },
    lastMessageType: { type: String },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IChannel>("Channel", ChannelSchema);
