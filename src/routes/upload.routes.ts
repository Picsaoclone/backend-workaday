import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import { uploadImage, uploadFile, uploadAvatar, uploadAny, uploadToCloudinary } from "../middleware/upload";
import cloudinary from "../config/cloudinary";

const router = Router();

// POST /api/upload/image - upload ảnh (dùng trong chat)
router.post("/image", authenticate, uploadImage.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "Không có file nào được upload." });

    const result = await uploadToCloudinary(file.buffer, {
      folder: "workaday/images",
      resourceType: "image",
      transformation: [{ width: 1920, crop: "limit", quality: "auto" }],
    });

    res.json({
      success: true,
      data: { url: result.url, publicId: result.publicId, name: file.originalname, type: file.mimetype, size: result.bytes, resourceType: "image" },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/upload/file - upload file bất kỳ (PDF, Word, Excel...)
router.post("/file", authenticate, uploadFile.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "Không có file nào được upload." });

    const result = await uploadToCloudinary(file.buffer, {
      folder: "workaday/files",
      resourceType: "raw",
    });

    res.json({
      success: true,
      data: { url: result.url, publicId: result.publicId, name: file.originalname, type: file.mimetype, size: result.bytes, resourceType: "file" },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/upload/avatar - upload ảnh đại diện
router.post("/avatar", authenticate, uploadAvatar.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "Không có file nào được upload." });

    const result = await uploadToCloudinary(file.buffer, {
      folder: "workaday/avatars",
      resourceType: "image",
      transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face", quality: "auto" }],
    });

    res.json({ success: true, data: { url: result.url, publicId: result.publicId } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/upload/message - upload nhiều file/ảnh kèm trong tin nhắn (tối đa 5)
router.post("/message", authenticate, uploadAny.array("files", 5), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ success: false, message: "Không có file nào." });

    const attachments = await Promise.all(
      files.map(async (file) => {
        const isImage = file.mimetype.startsWith("image/");
        const result = await uploadToCloudinary(file.buffer, {
          folder: isImage ? "workaday/images" : "workaday/files",
          resourceType: isImage ? "image" : "raw",
          ...(isImage && { transformation: [{ width: 1920, crop: "limit", quality: "auto" }] }),
        });
        return { url: result.url, publicId: result.publicId, name: file.originalname, type: file.mimetype, size: result.bytes, resourceType: isImage ? "image" : "file" };
      })
    );

    res.json({ success: true, data: attachments });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/upload/:publicId - xoá file trên Cloudinary
router.delete("/:publicId", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await cloudinary.uploader.destroy(decodeURIComponent(req.params.publicId));
    res.json({ success: true, message: "Đã xoá file." });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
