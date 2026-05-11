import mongoose, { Schema, Document } from "mongoose";

export interface IDepartment extends Document {
  companyId: string;
  name: string;
  description?: string;
  managerId?: string;
  color?: string;
}

const DepartmentSchema = new Schema<IDepartment>(
  {
    companyId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    managerId: { type: String },
    color: { type: String, default: "#3B82F6" },
  },
  { timestamps: true }
);

export default mongoose.model<IDepartment>("Department", DepartmentSchema);
