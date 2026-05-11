import mongoose, { Schema, Document } from "mongoose";

export interface IProject extends Document {
  companyId: string;
  name: string;
  description?: string;
  status: "planning" | "active" | "on-hold" | "completed" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  createdBy: string;
  leadId: string;
  teamIds: string[];
  startDate?: Date;
  endDate?: Date;
  progress: number;
  tags?: string[];
  color?: string;
}

const ProjectSchema = new Schema<IProject>(
  {
    companyId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    status: {
      type: String,
      enum: ["planning", "active", "on-hold", "completed", "cancelled"],
      default: "planning",
    },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    createdBy: { type: String, required: true },
    leadId: { type: String, required: true },
    teamIds: { type: [String], default: [] },
    startDate: { type: Date },
    endDate: { type: Date },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    tags: { type: [String], default: [] },
    color: { type: String, default: "#3B82F6" },
  },
  { timestamps: true }
);

export default mongoose.model<IProject>("Project", ProjectSchema);
