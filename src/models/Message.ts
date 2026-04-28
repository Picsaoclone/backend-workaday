import mongoose, { Schema, Document } from "mongoose";

export interface IMessage extends Document {
  companyId: string;
  channelId?: string;
  senderId: string;
  recipientId?: string;
  content: string;
  type: "text" | "file" | "image" | "system";
  attachments?: { url: string; name: string; type: string; size: number; resourceType?: string }[];
  replyTo?: string;
  editedAt?: Date;
  deletedAt?: Date;
  reactions?: { emoji: string; userIds: string[] }[];
  readBy?: { userId: string; readAt: Date }[];
}

const MessageSchema = new Schema<IMessage>(
  {
    companyId: { type: String, required: true, index: true },
    channelId: { type: String, index: true },
    senderId: { type: String, required: true },
    recipientId: { type: String },
    content: {
      type: String,
      default: "",
      required: function (this: any) {
        return !(Array.isArray(this.attachments) && this.attachments.length > 0);
      },
    },
    type: { type: String, enum: ["text", "file", "image", "system"], default: "text" },
    attachments: [
      {
        url: { type: String },
        name: { type: String },
        type: { type: String },
        size: { type: Number },
        resourceType: { type: String },
      },
    ],
    replyTo: { type: String },
    editedAt: { type: Date },
    deletedAt: { type: Date },
    reactions: [{ emoji: String, userIds: [String] }],
    readBy: [{ userId: String, readAt: Date }],
  },
  { timestamps: true }
);

export default mongoose.model<IMessage>("Message", MessageSchema);
