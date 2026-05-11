import type { Server } from "socket.io";
import Meeting from "../models/Meeting";
import { meetingInternals } from "../routes/meeting.routes";

const DEFAULT_POLL_MS = 30_000;

export const startMeetingScheduler = (io: Server | undefined) => {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;

    const now = Date.now();
    const nowDate = new Date(now);

    // 1) Reminders: scan next 60 minutes and send once when due.
    try {
      const upcoming = await Meeting.find({
        status: "scheduled",
        remindedAt: null,
        startAt: { $gt: nowDate, $lte: new Date(now + 60 * 60 * 1000) },
      })
        .select("_id companyId title startAt reminderMinutesBefore participants")
        .lean();

      for (const meeting of upcoming) {
        const startAtMs = meeting?.startAt ? new Date(meeting.startAt).getTime() : NaN;
        const mins = Number((meeting as any)?.reminderMinutesBefore ?? 10);
        if (!Number.isFinite(startAtMs)) continue;
        const dueAt = startAtMs - Math.max(0, mins) * 60 * 1000;
        if (now < dueAt) continue;

        // Atomic guard: only one runner sends.
        const updated = await Meeting.findOneAndUpdate(
          { _id: meeting._id, remindedAt: null, status: "scheduled" },
          { remindedAt: new Date() },
          { new: true }
        );
        if (!updated) continue;

        const receiverIds = (Array.isArray((meeting as any).participants) ? (meeting as any).participants : [])
          .filter((p: any) => String(p?.userId || "").trim())
          .filter((p: any) => String(p.status || "invited") !== "declined")
          .map((p: any) => String(p.userId));

        if (receiverIds.length > 0) {
          await meetingInternals.sendMeetingReminder(io, meeting as any, receiverIds);
        }
      }
    } catch (err) {
      console.warn("[meetings] reminder tick failed", err);
    }

    // 2) Auto call invites when meeting time arrives.
    try {
      // Invite calls for meetings that started within the last 10 minutes and haven't been invited yet.
      const due = await Meeting.find({
        status: "scheduled",
        callInvitedAt: null,
        startAt: { $lte: nowDate, $gte: new Date(now - 10 * 60 * 1000) },
      })
        .select("_id companyId title startAt createdBy participants callMode")
        .lean();

      for (const meeting of due) {
        const updated = await Meeting.findOneAndUpdate(
          { _id: meeting._id, callInvitedAt: null, status: "scheduled" },
          { callInvitedAt: new Date() },
          { new: true }
        );
        if (!updated) continue;

        await meetingInternals.sendMeetingCallInvites(io, meeting as any);
      }
    } catch (err) {
      console.warn("[meetings] call tick failed", err);
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, DEFAULT_POLL_MS);

  // Kick once on startup.
  void tick();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
};
