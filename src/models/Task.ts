import mongoose, { Schema, Document } from "mongoose";

export interface ITask extends Document {
  companyId: string;
  projectId?: string;
  title: string;
  description?: string;
  status: "todo" | "in-progress" | "review" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo: string;
  assignedBy: string;
  dueDate?: Date;
  startDate?: Date;
  completedAt?: Date;
  progress: number;
  subtasks?: string[];
  dependencies?: string[];
  attachments?: string[];
}

const TaskSchema = new Schema<ITask>(
  {
    companyId: { type: String, required: true, index: true },
    projectId: { type: String, default: null },
    title: { type: String, required: true, trim: true },
    description: { type: String },
    status: {
      type: String,
      enum: ["todo", "in-progress", "review", "done", "cancelled"],
      default: "todo",
    },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    assignedTo: { type: String, required: true },
    assignedBy: { type: String, required: true },
    dueDate: { type: Date },
    startDate: { type: Date },
    completedAt: { type: Date },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    subtasks: { type: [String], default: [] },
    dependencies: { type: [String], default: [] },
    attachments: { type: [String], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model<ITask>("Task", TaskSchema);
