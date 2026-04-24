import mongoose, { Document, Schema } from "mongoose";

export interface IPushToken extends Document {
  userId: string;
  token: string;
  provider?: "expo" | "fcm";
  platform?: "ios" | "android" | "web";
  lastSeenAt: Date;
}

const PushTokenSchema = new Schema<IPushToken>(
  {
    userId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true, index: true },
    provider: { type: String, enum: ["expo", "fcm"], default: "expo", index: true },
    platform: { type: String, enum: ["ios", "android", "web"], default: undefined },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default mongoose.model<IPushToken>("PushToken", PushTokenSchema);
