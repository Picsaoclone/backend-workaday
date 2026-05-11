import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import CompanyDocument, { DocumentCategory } from "../models/CompanyDocument";
import User from "../models/User";
import { uploadFile, uploadToCloudinary } from "../middleware/upload";

const router = Router();

const normalizeCategory = (raw: unknown): DocumentCategory | null => {
  const v = String(raw || "").trim();
  if (v === "Kỹ thuật" || v === "Thiết kế" || v === "Marketing" || v === "Nhân sự") return v;
  return null;
};

const parseBool = (raw: unknown): boolean => {
  if (raw === true) return true;
  if (raw === false) return false;
  const v = String(raw || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

// GET /api/documents?tab=all|important|recent&category=...&q=...
router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = String(req.user!.companyId);
    const tab = String(req.query.tab || "all").trim();
    const categoryRaw = String(req.query.category || "").trim();
    const q = String(req.query.q || "").trim();

    const filter: any = { companyId };

    const category = normalizeCategory(categoryRaw);
    if (category) {
      filter.category = category;
    }

    if (tab === "important") {
      filter.isStarred = true;
    }

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(escaped, "i");
      filter.$or = [{ title: rx }, { uploadedByName: rx }];
    }

    const sort = { createdAt: -1 as const };

    const docs = await CompanyDocument.find(filter).sort(sort).limit(200);
    res.json({ success: true, data: docs });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/documents/stats
router.get("/stats", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const companyId = String(req.user!.companyId);
    const quotaBytes = 50 * 1024 * 1024 * 1024; // 50 GB

    const agg = await CompanyDocument.aggregate([
      { $match: { companyId } },
      { $group: { _id: null, usedBytes: { $sum: "$sizeBytes" }, count: { $sum: 1 } } },
    ]);

    const usedBytes = Number(agg?.[0]?.usedBytes || 0);
    const count = Number(agg?.[0]?.count || 0);

    res.json({ success: true, data: { usedBytes, quotaBytes, count } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/documents (admin/manager)
router.post("/", authenticate, requireRole("admin", "manager"), uploadFile.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = String(req.user!.companyId);
    const uploaderId = String(req.user!.id);

    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: "Không có file nào được upload." });

    const category = normalizeCategory(req.body?.category);
    if (!category) return res.status(400).json({ success: false, message: "Danh mục không hợp lệ." });

    const title = String(req.body?.title || "").trim() || String(file.originalname || "Tài liệu").trim();
    const isStarred = parseBool(req.body?.isStarred);

    const uploader = await User.findById(uploaderId).select("name email").lean();
    const uploadedByName = String((uploader as any)?.name || (uploader as any)?.email || "").trim() || "Người dùng";

    const result = await uploadToCloudinary(file.buffer, {
      folder: `workaday/documents/${companyId}`,
      resourceType: "raw",
    });

    const doc = await CompanyDocument.create({
      companyId,
      title,
      category,
      fileUrl: result.url,
      publicId: result.publicId,
      mimeType: file.mimetype,
      sizeBytes: result.bytes,
      uploadedById: uploaderId,
      uploadedByName,
      isStarred,
    });

    res.status(201).json({ success: true, data: doc });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/documents/:id/star (admin/manager)
router.patch("/:id/star", authenticate, requireRole("admin", "manager"), async (req: AuthRequest, res: Response) => {
  try {
    const companyId = String(req.user!.companyId);
    const id = String(req.params.id || "").trim();
    const isStarred = typeof req.body?.isStarred === "boolean" ? req.body.isStarred : null;

    const doc = await CompanyDocument.findOne({ _id: id, companyId });
    if (!doc) return res.status(404).json({ success: false, message: "Không tìm thấy tài liệu." });

    (doc as any).isStarred = isStarred === null ? !(doc as any).isStarred : isStarred;
    await doc.save();

    res.json({ success: true, data: doc });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
