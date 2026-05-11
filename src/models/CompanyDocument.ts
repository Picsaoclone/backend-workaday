import mongoose, { Schema, Document as MongooseDocument } from "mongoose";

export type DocumentCategory = "Kỹ thuật" | "Thiết kế" | "Marketing" | "Nhân sự";

export interface ICompanyDocument extends MongooseDocument {
  companyId: string;
  title: string;
  category: DocumentCategory;
  fileUrl: string;
  publicId: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedByName: string;
  isStarred: boolean;
}

const CompanyDocumentSchema = new Schema<ICompanyDocument>(
  {
    companyId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, enum: ["Kỹ thuật", "Thiết kế", "Marketing", "Nhân sự"], index: true },

    fileUrl: { type: String, required: true },
    publicId: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },

    uploadedById: { type: String, required: true },
    uploadedByName: { type: String, required: true },

    isStarred: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

export default mongoose.model<ICompanyDocument>("CompanyDocument", CompanyDocumentSchema);
