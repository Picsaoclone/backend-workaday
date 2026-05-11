import multer from "multer";
import { Request } from "express";
import cloudinary from "../config/cloudinary";
import { Readable } from "stream";

// Upload buffer thẳng lên Cloudinary dùng upload_stream (cloudinary v2)
export const uploadToCloudinary = (
  buffer: Buffer,
  options: {
    folder: string;
    resourceType?: "image" | "raw" | "video" | "auto";
    publicId?: string;
    transformation?: object[];
  }
): Promise<{ url: string; publicId: string; bytes: number }> => {
  return new Promise((resolve, reject) => {
    const uploadOpts: any = {
      folder: options.folder,
      resource_type: options.resourceType || "auto",
      use_filename: true,
      unique_filename: true,
      ...(options.publicId && { public_id: options.publicId }),
      ...(options.transformation && { transformation: options.transformation }),
    };

    const uploadStream = cloudinary.uploader.upload_stream(uploadOpts, (error, result) => {
      if (error || !result) return reject(error || new Error("Upload thất bại"));
      resolve({ url: result.secure_url, publicId: result.public_id, bytes: result.bytes });
    });

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

// Dùng memory storage — không lưu disk, đẩy thẳng lên Cloudinary trong route
const memoryStorage = multer.memoryStorage();

const imageFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ cho phép upload ảnh (jpg, png, gif, webp)."));
  }
};

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const blockedTypes = ["application/x-msdownload", "application/x-executable", "application/x-sh"];
  if (blockedTypes.includes(file.mimetype)) {
    cb(new Error("Không cho phép upload file thực thi."));
  } else {
    cb(null, true);
  }
};

export const uploadImage = multer({ storage: memoryStorage, fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
export const uploadFile  = multer({ storage: memoryStorage, fileFilter: fileFilter,  limits: { fileSize: 25 * 1024 * 1024 } });
export const uploadAvatar = multer({ storage: memoryStorage, fileFilter: imageFilter, limits: { fileSize: 5 * 1024 * 1024 } });
export const uploadAny   = multer({ storage: memoryStorage, fileFilter: fileFilter,  limits: { fileSize: 25 * 1024 * 1024 } });
