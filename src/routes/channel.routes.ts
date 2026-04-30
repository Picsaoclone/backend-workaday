import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../middleware/auth";
import Channel from "../models/Channel";
import User from "../models/User";
import Message from "../models/Message";

const router = Router();

router.get("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const me = String(req.user!.id);
    const companyId = String(req.user!.companyId);

    const truncate = (value: string, maxLen: number) => {
      const clean = String(value || "").trim();
      if (clean.length <= maxLen) return clean;
      return `${clean.slice(0, Math.max(0, maxLen - 1))}…`;
    };

    // Company channels remain company-scoped.
    // DM channels can be cross-company (for accepted friends), so list them by membership.
    const channels = await Channel.find({
      $or: [
        {
          companyId,
          $or: [{ type: "public" }, { memberIds: me }],
        },
        { type: "dm", memberIds: me },
      ],
    }).sort({ lastMessageAt: -1 });

    // Backfill preview data for channels that don't have it yet (legacy channels).
    // This is response-only (no DB migration), so clients can immediately show previews.
    const missingPreviewIds = (channels as any[])
      .filter((ch) => {
        const hasText = typeof (ch as any)?.lastMessageText === "string" && String((ch as any).lastMessageText).trim().length > 0;
        const hasAt = !!(ch as any)?.lastMessageAt;
        return !hasText && (hasAt || true);
      })
      .map((ch) => String((ch as any)?._id))
      .filter(Boolean);

    if (missingPreviewIds.length > 0) {
      // Use $toString so we can match channelId whether it's stored as a string or an ObjectId in legacy data.
      const latestByChannel = await Message.aggregate([
        {
          $addFields: {
            channelIdStr: { $toString: "$channelId" },
          },
        },
        {
          $match: {
            channelIdStr: { $in: missingPreviewIds },
            deletedAt: null,
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$channelIdStr",
            senderId: { $first: "$senderId" },
            type: { $first: "$type" },
            content: { $first: "$content" },
            attachments: { $first: "$attachments" },
            createdAt: { $first: "$createdAt" },
          },
        },
      ]);

      const latestMap = new Map<string, any>();
      for (const row of latestByChannel as any[]) {
        if (row?._id) latestMap.set(String(row._id), row);
      }

      for (const ch of channels as any[]) {
        const id = String(ch?._id || "");
        if (!id) continue;
        const row = latestMap.get(id);
        if (!row) continue;

        const attachments = Array.isArray(row.attachments) ? row.attachments : [];
        const msgType = String(row.type || "text");
        const previewText = attachments.length > 0
          ? (msgType === "image" ? "(Ảnh)" : "(Tệp)")
          : (truncate(String(row.content || ""), 140) || "(Tin nhắn mới)");

        ch.lastMessageText = previewText;
        ch.lastMessageSenderId = String(row.senderId || "");
        ch.lastMessageType = msgType;
        if (!ch.lastMessageAt && row.createdAt) ch.lastMessageAt = row.createdAt;
      }
    }

    const pickNewest = (a: any, b: any) => {
      const aTime = a?.lastMessageAt ? new Date(a.lastMessageAt).getTime() : (a?.updatedAt ? new Date(a.updatedAt).getTime() : 0);
      const bTime = b?.lastMessageAt ? new Date(b.lastMessageAt).getTime() : (b?.updatedAt ? new Date(b.updatedAt).getTime() : 0);
      return bTime > aTime ? b : a;
    };

    const dmMap = new Map<string, any>();
    const nonDm: any[] = [];

    for (const ch of channels as any[]) {
      if (String(ch?.type) !== "dm") {
        nonDm.push(ch);
        continue;
      }

      const dmUserIds: string[] = Array.isArray((ch as any).dmUserIds) ? (ch as any).dmUserIds.map(String) : [];
      const memberIds: string[] = Array.isArray((ch as any).memberIds) ? (ch as any).memberIds.map(String) : [];

      const pair = (dmUserIds.length === 2 ? dmUserIds : memberIds)
        .filter(Boolean)
        .slice(0, 2)
        .map(String)
        .sort();

      // If we can't compute a stable pair key, keep it (rare/legacy data).
      if (pair.length !== 2) {
        nonDm.push(ch);
        continue;
      }

      const key = `${pair[0]}::${pair[1]}`;
      const existing = dmMap.get(key);
      dmMap.set(key, existing ? pickNewest(existing, ch) : ch);
    }

    const deduped = [...nonDm, ...Array.from(dmMap.values())].sort((a: any, b: any) => {
      const aTime = a?.lastMessageAt ? new Date(a.lastMessageAt).getTime() : (a?.updatedAt ? new Date(a.updatedAt).getTime() : 0);
      const bTime = b?.lastMessageAt ? new Date(b.lastMessageAt).getTime() : (b?.updatedAt ? new Date(b.updatedAt).getTime() : 0);
      return bTime - aTime;
    });

    res.json({ success: true, data: deduped });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const channel = await Channel.create({
      ...req.body,
      companyId: req.user!.companyId,
      createdBy: req.user!.id,
      memberIds: [...(req.body.memberIds || []), req.user!.id],
      adminIds: [req.user!.id],
    });
    res.status(201).json({ success: true, data: channel });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/channels/:id/join
router.post("/:id/join", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const channel = await Channel.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { memberIds: req.user!.id } },
      { new: true }
    );
    res.json({ success: true, data: channel });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/channels/:id/members
// Add members to an existing group channel (public/private). Only channel admins can add.
router.post("/:id/members", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { memberIds } = req.body as { memberIds?: string[] };
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ success: false, message: "Thiếu danh sách thành viên." });
    }

    const channel = await Channel.findOne({ _id: req.params.id, companyId: req.user!.companyId });
    if (!channel) {
      return res.status(404).json({ success: false, message: "Không tìm thấy kênh." });
    }

    if (channel.type === "dm") {
      return res.status(400).json({ success: false, message: "Không thể thêm thành viên vào kênh DM." });
    }

    if (!Array.isArray(channel.adminIds) || !channel.adminIds.includes(req.user!.id)) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền thêm thành viên vào kênh này." });
    }

    // Validate users belong to the same company and are active.
    const uniqueIds = Array.from(new Set(memberIds.map((id) => String(id))));
    const validUsers = await User.find({
      _id: { $in: uniqueIds },
      companyId: req.user!.companyId,
      isActive: true,
    }).select("_id");

    const validIds = validUsers.map((u) => u._id.toString());
    if (validIds.length === 0) {
      return res.status(400).json({ success: false, message: "Không có thành viên hợp lệ để thêm." });
    }

    const updated = await Channel.findByIdAndUpdate(
      channel._id,
      { $addToSet: { memberIds: { $each: validIds } } },
      { new: true }
    );

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
