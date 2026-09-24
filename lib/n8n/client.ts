import "server-only";
import { createHash } from "node:crypto";

// The only module that talks to n8n. Contract: .claude/skills/integrating-n8n-webhooks.

const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000]; // 3 attempts in total

export type N8nEvent = "quote-request" | "lead-created"; // one event — one webhook path in n8n

export type TriggerOptions = {
  idempotencyKey: string; // created once per business operation and stored with the record
  correlationId: string;
  callbackUrl?: string; // async events only
};

export type TriggerResult =
  | { ok: true; status: number; attempts: number }
  | { ok: false; status: number | null; attempts: number; reason: "http" | "timeout" | "network" };

function requireEnv(name: "N8N_WEBHOOK_BASE_URL" | "N8N_WEBHOOK_TOKEN" | "APP_BASE_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`); // the name, never the value
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Where n8n posts the result of an async event: app/api/n8n/[event]/route.ts.
export function n8nCallbackUrl(event: N8nEvent): string {
  return `${requireEnv("APP_BASE_URL").replace(/\/+$/, "")}/api/n8n/${event}`;
}

export async function triggerN8n(
  event: N8nEvent,
  data: Record<string, unknown>,
  { idempotencyKey, correlationId, callbackUrl }: TriggerOptions,
): Promise<TriggerResult> {
  const url = `${requireEnv("N8N_WEBHOOK_BASE_URL").replace(/\/+$/, "")}/${event}`;
  const body = JSON.stringify({ version: 1, event, data, ...(callbackUrl ? { callbackUrl } : {}) });
  const headers = {
    "content-type": "application/json",
    "x-n8n-token": requireEnv("N8N_WEBHOOK_TOKEN"),
    "idempotency-key": idempotencyKey,
    "x-correlation-id": correlationId,
  };
  const bodyBytes = Buffer.byteLength(body);
  const bodySha256 = createHash("sha256").update(body).digest("hex");

  let result: TriggerResult = { ok: false, status: null, attempts: 0, reason: "network" };
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    const started = Date.now();
    let retryable: boolean;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await response.body?.cancel(); // only the status code matters
      result = response.ok
        ? { ok: true, status: response.status, attempts: attempt }
        : { ok: false, status: response.status, attempts: attempt, reason: "http" };
      retryable = response.status >= 500; // 5xx, 524 included; 4xx is a bug to fix, not to retry
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      result = { ok: false, status: null, attempts: attempt, reason: timeout ? "timeout" : "network" };
      retryable = true;
    }
    console.info("n8n.request", {
      event, correlationId, attempt, status: result.status, ms: Date.now() - started, bodyBytes, bodySha256,
    });
    if (result.ok || !retryable || attempt > RETRY_DELAYS_MS.length) return result;
    await sleep(RETRY_DELAYS_MS[attempt - 1]);
  }
  return result;
}
