import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../middleware/auth";
import User from "../models/User";
import FriendRequest from "../models/FriendRequest";
import { areFriends, normalizePhone, toId } from "../utils/friends";

const router = Router();

router.get("/lookup", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const phone = normalizePhone(req.query.phone);
    if (!phone) {
      return res.status(400).json({ success: false, message: "Thiếu số điện thoại." });
    }

    const me = toId(req.user?.id);

    const user = await User.findOne({ phone, isActive: true })
      .select("_id name email phone avatar companyId role position isActive")
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "Không tìm thấy người dùng với số điện thoại này." });
    }

    if (toId((user as any)?._id) === me) {
      return res.status(400).json({ success: false, message: "Bạn không thể kết bạn với chính mình." });
    }

    res.json({ success: true, data: user });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Không thể tra cứu." });
  }
});

router.post("/requests", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const me = toId(req.user?.id);
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({ success: false, message: "Thiếu số điện thoại." });
    }

    const target = await User.findOne({ phone, isActive: true })
      .select("_id name phone companyId isActive")
      .lean();

    if (!target?._id) {
      return res.status(404).json({ success: false, message: "Không tìm thấy người dùng với số điện thoại này." });
    }

    const targetId = toId((target as any)._id);
    if (!targetId || targetId === me) {
      return res.status(400).json({ success: false, message: "Người nhận không hợp lệ." });
    }

    if (await areFriends(me, targetId)) {
      return res.status(400).json({ success: false, message: "Hai bạn đã là bạn bè." });
    }

    const existedPending = await FriendRequest.findOne({
      status: "pending",
      $or: [
        { requesterId: me, recipientId: targetId },
        { requesterId: targetId, recipientId: me },
      ],
    })
      .select("_id requesterId recipientId")
      .lean();

    if (existedPending) {
      return res.status(400).json({ success: false, message: "Đã có yêu cầu kết bạn đang chờ." });
    }

    const created = await FriendRequest.create({
      requesterId: me,
      recipientId: targetId,
      status: "pending",
    });

    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    // Handle unique index collisions gracefully.
    if (String(err?.code) === "11000") {
      return res.status(400).json({ success: false, message: "Yêu cầu đã tồn tại." });
    }
    res.status(500).json({ success: false, message: err?.message || "Không thể gửi yêu cầu." });
  }
});

router.get("/requests", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const me = toId(req.user?.id);

    const pending = await FriendRequest.find({
      status: "pending",
      $or: [{ requesterId: me }, { recipientId: me }],
    })
      .sort({ createdAt: -1 })
      .lean();

    const userIds = Array.from(
      new Set(
        pending
          .flatMap((r: any) => [toId(r.requesterId), toId(r.recipientId)])
          .filter(Boolean)
      )
    );

    const users = await User.find({ _id: { $in: userIds }, isActive: true })
      .select("_id name email phone avatar companyId role position isActive")
      .lean();

    const userMap: Record<string, any> = {};
    users.forEach((u: any) => {
      userMap[toId(u._id)] = u;
    });

    const incoming = pending
      .filter((r: any) => toId(r.recipientId) === me)
      .map((r: any) => ({
        _id: r._id,
        createdAt: r.createdAt,
        fromUser: userMap[toId(r.requesterId)] || { _id: r.requesterId },
      }));

    const outgoing = pending
      .filter((r: any) => toId(r.requesterId) === me)
      .map((r: any) => ({
        _id: r._id,
        createdAt: r.createdAt,
        toUser: userMap[toId(r.recipientId)] || { _id: r.recipientId },
      }));

    res.json({ success: true, data: { incoming, outgoing } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Không thể tải yêu cầu." });
  }
});

router.post("/requests/:id/accept", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const me = toId(req.user?.id);
    const id = toId(req.params.id);

    const existing = await FriendRequest.findOne({ _id: id, status: "pending" });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Không tìm thấy yêu cầu." });
    }

    if (toId((existing as any).recipientId) !== me) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền." });
    }

    (existing as any).status = "accepted";
    (existing as any).respondedAt = new Date();
    await existing.save();

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Không thể chấp nhận." });
  }
});

router.post("/requests/:id/reject", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const me = toId(req.user?.id);
    const id = toId(req.params.id);

    const existing = await FriendRequest.findOne({ _id: id, status: "pending" });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Không tìm thấy yêu cầu." });
    }

    if (toId((existing as any).recipientId) !== me) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền." });
    }

    (existing as any).status = "rejected";
    (existing as any).respondedAt = new Date();
    await existing.save();

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Không thể từ chối." });
  }
});

router.get("/friends", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const me = toId(req.user?.id);

    const accepted = await FriendRequest.find({
      status: "accepted",
      $or: [{ requesterId: me }, { recipientId: me }],
    })
      .sort({ updatedAt: -1 })
      .lean();

    const friendIds = Array.from(
      new Set(
        accepted
          .map((r: any) => {
            const requesterId = toId(r.requesterId);
            const recipientId = toId(r.recipientId);
            return requesterId === me ? recipientId : requesterId;
          })
          .filter(Boolean)
      )
    );

    if (friendIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const friends = await User.find({ _id: { $in: friendIds }, isActive: true })
      .select("_id name email phone avatar companyId role position isActive")
      .lean();

    res.json({ success: true, data: friends });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || "Không thể tải bạn bè." });
  }
});

export { areFriends, normalizePhone };
export default router;
