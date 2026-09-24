import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

// Callbacks from n8n. The order of the steps is the team contract
// (.claude/skills/integrating-n8n-webhooks/references/contract.md, section 3): do not reorder.

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_S = 300;

// [event] in the path → events that may arrive in the body
const EVENTS: Record<string, readonly string[]> = {
  "quote-request": ["quote-request.completed", "quote-request.failed"],
};

type CallbackBody = {
  version: 1;
  event: string;
  data: {
    jobId: string;
    status: "completed" | "failed";
    correlationId?: string;
    requestIdempotencyKey?: string;
    result?: { documentUrl?: string };
    error?: { code?: string };
    completedAt?: string;
  };
};

function signatureMatches(secret: string, timestamp: string, raw: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex"));
  const given = Buffer.from(header.slice("sha256=".length));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const optionalString = (value: unknown) => value === undefined || typeof value === "string";

function parseCallback(raw: string): CallbackBody | null {
  try {
    const body = JSON.parse(raw) as Partial<CallbackBody> | null;
    const data = body?.data;
    if (body?.version !== 1 || typeof body.event !== "string") return null;
    if (!data || typeof data.jobId !== "string" || !data.jobId) return null;
    if (data.status !== "completed" && data.status !== "failed") return null;
    if (!optionalString(data.correlationId) || !optionalString(data.requestIdempotencyKey)) return null;
    if (!data.requestIdempotencyKey && !data.correlationId) return null;
    return body as CallbackBody;
  } catch {
    return null;
  }
}

// The link is rendered as <a href> on /quotes/[id]: only http(s), never javascript: or data:.
function documentUrlFrom(body: CallbackBody): string | null {
  const value = body.data.result?.documentUrl;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/n8n/[event]">) {
  const started = Date.now();
  const { event } = await ctx.params;
  const correlationId = request.headers.get("x-correlation-id")?.slice(0, 64) ?? null;
  // One exit: a log line without bodies or personal data, and a short answer without details.
  const respond = (status: number, body: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    console.info("n8n.callback", { event, correlationId, status, ms: Date.now() - started, ...extra });
    return Response.json(body, { status });
  };

  // 1. Known event and JSON — before reading the body.
  const allowed = EVENTS[event];
  if (!allowed) return respond(404, { error: "not_found" });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return respond(415, { error: "unsupported_media_type" });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return respond(413, { error: "payload_too_large" });
  }

  // 2. Raw text. No request.json() and no JSON.parse before step 7.
  const raw = await request.text();

  // 3. Size.
  const bodyBytes = Buffer.byteLength(raw);
  if (bodyBytes > MAX_BODY_BYTES) return respond(413, { error: "payload_too_large" }, { bodyBytes });

  // 4. Time window, both ways (300 s).
  const timestamp = request.headers.get("x-n8n-timestamp") ?? "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_S) {
    return respond(401, { error: "unauthorized" });
  }

  // 5. Signature: lengths + timingSafeEqual.
  const secret = process.env.N8N_CALLBACK_SECRET;
  if (!secret) return respond(500, { error: "server_error" }, { reason: "N8N_CALLBACK_SECRET is not set" });
  if (!signatureMatches(secret, timestamp, raw, request.headers.get("x-n8n-signature"))) {
    return respond(401, { error: "unauthorized" });
  }

  // 6. Claim the key. Demo: a Set in process memory (lib/db.ts); production: a unique row in the DB.
  const key = request.headers.get("idempotency-key");
  if (!key) return respond(400, { error: "bad_request" });
  if (!(await db.claimCallbackKey(key))) return respond(200, { duplicate: true });

  try {
    // 7. Only now JSON and shape; the event and the key must match the signed body.
    const body = parseCallback(raw);
    const documentUrl = body ? documentUrlFrom(body) : null;
    if (
      !body ||
      !allowed.includes(body.event) ||
      body.event !== `${event}.${body.data.status}` ||
      key !== `${body.data.jobId}:${body.event}` ||
      (body.data.status === "completed" && !documentUrl)
    ) {
      await db.releaseCallbackKey(key);
      return respond(400, { error: "bad_request" }, { bodyBytes });
    }

    // 8. Minimal state — before the response: after a 2xx n8n will not retry.
    const failed = body.data.status === "failed";
    const saved = await db.applyQuoteResult({
      requestIdempotencyKey: body.data.requestIdempotencyKey,
      correlationId: body.data.correlationId,
      status: failed ? "failed" : "ready",
      documentUrl: failed ? null : documentUrl,
      failureCode: failed ? `workflow_${String(body.data.error?.code ?? "failed").slice(0, 64)}` : null,
    });
    if (!saved) {
      await db.releaseCallbackKey(key);
      return respond(400, { error: "bad_request" }, { bodyBytes });
    }
  } catch (error) {
    await db.releaseCallbackKey(key); // otherwise Retry On Fail gets "duplicate" and the result is lost
    return respond(500, { error: "server_error" }, { code: error instanceof Error ? error.name : "unknown" });
  }

  // 9. Nothing slow to do yet; e-mails or notifications would go into after() here (step 10).
  return respond(202, { ok: true }, { bodyBytes });
}
