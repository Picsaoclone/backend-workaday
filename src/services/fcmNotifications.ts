import admin from "firebase-admin";

let firebaseApp: admin.app.App | null = null;

const getFirebaseApp = (): admin.app.App | null => {
  if (firebaseApp) return firebaseApp;

  const raw = String(process.env.FCM_SERVICE_ACCOUNT_JSON || "").trim();
  const rawBase64 = String(process.env.FCM_SERVICE_ACCOUNT_JSON_BASE64 || "").trim();

  // Allow base64 to contain line breaks/whitespace (common when copy/pasting).
  const rawBase64Sanitized = rawBase64.replace(/\s+/g, "");

  const jsonString = raw
    ? raw
    : rawBase64Sanitized
      ? (() => {
          try {
            return Buffer.from(rawBase64Sanitized, "base64").toString("utf8");
          } catch {
            return "";
          }
        })()
      : "";

  if (!jsonString) return null;

  try {
    const json = JSON.parse(jsonString);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(json),
    });
    return firebaseApp;
  } catch (err) {
    console.warn("FCM init failed (FCM_SERVICE_ACCOUNT_JSON / _BASE64)", err);
    return null;
  }
};

const toStringMap = (data: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
};

export const sendFcmDataToTokens = async (tokens: string[], data: Record<string, unknown>): Promise<boolean> => {
  const app = getFirebaseApp();
  if (!app) {
    // Optional feature: if no service account configured, skip quietly.
    return false;
  }

  const deduped = Array.from(new Set(tokens)).filter(Boolean);
  if (deduped.length === 0) return false;

  try {
    const messaging = admin.messaging(app);

    const message: admin.messaging.MulticastMessage = {
      tokens: deduped,
      // Data-only message so Android can deliver to the background handler.
      data: toStringMap(data),
      android: {
        priority: "high",
        ttl: 30 * 1000,
      },
    };

    const resp = await messaging.sendEachForMulticast(message);
    if (resp.failureCount > 0) {
      const failures = resp.responses
        .map((r, idx) => ({ ok: r.success, idx, err: r.error?.message }))
        .filter((x) => !x.ok);
      console.warn("FCM send failures", { failureCount: resp.failureCount, failures: failures.slice(0, 10) });
    }

    // Treat total failure as a send failure so callers can fall back.
    if (resp.failureCount >= deduped.length) return false;
    return true;
  } catch (err) {
    console.warn("FCM send failed", err);
    return false;
  }
};
