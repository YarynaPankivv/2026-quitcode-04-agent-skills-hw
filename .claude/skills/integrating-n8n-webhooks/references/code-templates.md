# Шаблони коду (Next.js 16, App Router, TypeScript)

Шаблони — відправна точка, не копі-паст наосліп: імена моделей, `db`-функції й форма `data`
залежать від проєкту. Порядок кроків, заголовки, таймаут, повтори й перевірки підпису —
**не змінюються**. Після адаптації — `check-contract.mjs` і Verify зі `SKILL.md`.

Перевірено 24.09.2026 на Next.js 16.3.5 (копія LeadDesk із заглушкою `db`): `tsc` і `eslint` без
помилок. Роут: 14 випадків підписаних колбеків дали очікувані коди (202, повтор → 200 duplicate,
змінене чи переформатоване тіло → 401, час ±301 с → 401, чужий ключ / подія → 400, 415, 404,
413), справжній колбек мока → 202. Клієнт проти мока: 202 з `auth=ok idempotency=new`; 524 → 3
спроби з тим самим ключем (паузи 1 с і 3 с); 403 і 404 (тестовий URL) — 1 спроба; мережева
помилка — 3 спроби. Звільнення ключа на збої запису (крок 8) окремо не перевірялось.

## lib/n8n/client.ts

Єдине місце, де код ходить у n8n.

```ts
import "server-only";
import { createHash } from "node:crypto";

const TIMEOUT_MS = 10_000;
const RETRY_DELAYS_MS = [1_000, 3_000]; // 3 спроби разом

export type N8nEvent = "lead-created" | "quote-request"; // одна подія — один шлях у n8n

export type TriggerOptions = {
  idempotencyKey: string; // створений один раз на бізнес-операцію і збережений з записом
  correlationId: string;
  callbackUrl?: string; // лише для асинхронних подій
};

export type TriggerResult =
  | { ok: true; status: number; attempts: number }
  | { ok: false; status: number | null; attempts: number; reason: "http" | "timeout" | "network" };

function requireEnv(name: "N8N_WEBHOOK_BASE_URL" | "N8N_WEBHOOK_TOKEN"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`); // назва змінної, не значення
  return value;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      await response.body?.cancel(); // дивимось лише на код статусу
      result = response.ok
        ? { ok: true, status: response.status, attempts: attempt }
        : { ok: false, status: response.status, attempts: attempt, reason: "http" };
      retryable = response.status >= 500; // 5xx, зокрема 524; 4xx — виправляти, не повторювати
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
```

- `import "server-only"` у Next.js 16 працює без встановлення пакета.
- Не логуй `url` (може містити нестандартний хост/шлях клієнта), `headers`, `body`, `data`.
- Не додавай `export const runtime = "edge"` ні тут, ні в роутах.

## Server Action, що запускає воркфлоу

Форма, стан, помилки полів і перевірка сесії — за скілом `building-client-form`. Тут — лише
частина про n8n.

```ts
"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { triggerN8n } from "@/lib/n8n/client";

export async function requestQuote(_prev: QuoteFormState, formData: FormData): Promise<QuoteFormState> {
  // 1. Сесія / права (для публічної форми — свідомо без сесії) — server-auth-actions.
  // 2. Валідація на сервері.
  const parsed = parseQuoteForm(formData);
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values: parsed.values };

  // 3. Запис ДО виклику n8n: статус queued, ключі — разом із записом.
  const quote = await db.insertQuote({
    ...parsed.data,
    status: "queued",
    idempotencyKey: randomUUID(),
    correlationId: randomUUID(),
  });

  // 4. n8n — після відповіді користувачу (server-after-nonblocking).
  after(async () => {
    const result = await triggerN8n(
      "quote-request",
      { quoteId: quote.id, company: quote.company, budget: quote.budget }, // мінімум, не весь запис
      {
        idempotencyKey: quote.idempotencyKey,
        correlationId: quote.correlationId,
        callbackUrl: `${process.env.APP_BASE_URL}/api/n8n/quote-request`,
      },
    );
    if (!result.ok) await db.updateQuoteStatus(quote.id, "failed");
  });

  // 5. Лише статус і id — не рядок з бази.
  return { status: "ok", id: quote.id };
}
```

- Подія «до відома» (`lead-created`): той самий `after(() => triggerN8n(…))`, без `callbackUrl`.
- `APP_BASE_URL` відсутня → не будуй `callbackUrl` з `undefined`: кинь помилку з назвою змінної.
- Сторінка результату (`/quotes/[id]`) показує `queued` → `ready`/`failed` з бази, а не чекає n8n.

## app/api/n8n/[event]/route.ts

Колбек від n8n. Кроки пронумеровано так само, як у `contract.md`.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_S = 300;

// [event] у шляху → події, які можуть прийти в тілі
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

function parseCallback(raw: string): CallbackBody | null {
  try {
    const body = JSON.parse(raw) as Partial<CallbackBody> | null;
    const data = body?.data;
    if (body?.version !== 1 || typeof body.event !== "string") return null;
    if (!data || typeof data.jobId !== "string" || (data.status !== "completed" && data.status !== "failed")) return null;
    return body as CallbackBody;
  } catch {
    return null;
  }
}

// The link ends up in <a href> on the status page: only http(s), never javascript: or data:.
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
  const correlationId = request.headers.get("x-correlation-id");
  // Одна точка виходу: журнал без тіла й персональних даних + коротка відповідь без подробиць.
  const respond = (status: number, body: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    console.info("n8n.callback", { event, correlationId, status, ms: Date.now() - started, ...extra });
    return Response.json(body, { status });
  };

  // 1. Відома подія і JSON — до читання тіла.
  const allowed = EVENTS[event];
  if (!allowed) return respond(404, { error: "not_found" });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return respond(415, { error: "unsupported_media_type" });
  }

  // 2. Сирий текст. Ні request.json(), ні JSON.parse до кроку 7.
  const raw = await request.text();

  // 3. Розмір.
  const bodyBytes = Buffer.byteLength(raw);
  if (bodyBytes > MAX_BODY_BYTES) return respond(413, { error: "payload_too_large" }, { bodyBytes });

  // 4. Вікно часу, в обидва боки.
  const timestamp = request.headers.get("x-n8n-timestamp") ?? "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_S) {
    return respond(401, { error: "unauthorized" });
  }

  // 5. Підпис: довжини + timingSafeEqual.
  const secret = process.env.N8N_CALLBACK_SECRET;
  if (!secret) return respond(500, { error: "server_error" }, { reason: "N8N_CALLBACK_SECRET is not set" });
  if (!signatureMatches(secret, timestamp, raw, request.headers.get("x-n8n-signature"))) {
    return respond(401, { error: "unauthorized" });
  }

  // 6. Застовпити ключ (у продакшні — унікальний запис у БД/KV).
  const key = request.headers.get("idempotency-key");
  if (!key) return respond(400, { error: "bad_request" });
  if (!(await db.claimCallbackKey(key))) return respond(200, { duplicate: true });

  try {
    // 7. Лише тепер — JSON і форма; подія й ключ мають збігатися з підписаним тілом.
    const body = parseCallback(raw);
    if (!body || !allowed.includes(body.event) || key !== `${body.data.jobId}:${body.event}`) {
      await db.releaseCallbackKey(key);
      return respond(400, { error: "bad_request" });
    }

    // 8. Мінімальний стан — ДО відповіді.
    const failed = body.data.status === "failed";
    const saved = await db.applyQuoteResult({
      requestIdempotencyKey: body.data.requestIdempotencyKey, // запис шукаємо за ключем запиту…
      correlationId: body.data.correlationId, //                …або за correlation id
      status: failed ? "failed" : "ready",
      documentUrl: failed ? null : documentUrlFrom(body), // лише http(s): піде в <a href>
      failureCode: failed ? `workflow_${String(body.data.error?.code ?? "failed").slice(0, 64)}` : null,
    });
    if (!saved) {
      await db.releaseCallbackKey(key);
      return respond(400, { error: "bad_request" });
    }
  } catch (error) {
    await db.releaseCallbackKey(key); // інакше Retry On Fail отримає duplicate і результат загубиться
    return respond(500, { error: "server_error" }, { code: error instanceof Error ? error.name : "unknown" });
  }

  // 10. Повільне — після відповіді.
  after(() => {
    /* лист клієнту, сповіщення менеджеру… з try/catch і журналом без персональних даних */
  });

  // 9.
  return respond(202, { ok: true }, { bodyBytes });
}
```

- Лише `POST`. Не експортуй `GET` для колбека (кешування, журнали проксі).
- `db.claimCallbackKey` / `releaseCallbackKey` у демо — `Set` у пам'яті процесу (як інші дані
  `lib/db.ts` у LeadDesk); у справжньому проєкті — таблиця з унікальним ключем. Скажи людині.
- Відповіді з помилкою — без подробиць: ні причини, ні очікуваного підпису, ні стеку.

## .env.example

```dotenv
# n8n (server-only: no NEXT_PUBLIC_ prefix). Real values live in .env.local only.
N8N_WEBHOOK_BASE_URL=http://127.0.0.1:5678/webhook
N8N_WEBHOOK_TOKEN=change-me-webhook-token
N8N_CALLBACK_SECRET=change-me-callback-secret
APP_BASE_URL=http://127.0.0.1:3000
```

Старі змінні з повним URL (`N8N_WEBHOOK_URL=…/webhook-test/lead-created`) прибрати: тестовий URL
у `.env.example` — порушення контракту, а повний шлях дублює подію з коду. Людині — нагадати
оновити власний `.env.local` (значень не читати).
