#!/usr/bin/env node
// Signed-callback matrix against the app's n8n callback route (skill integrating-n8n-webhooks).
// Signs exactly like n8n's Crypto node and the mock: sha256=<hex HMAC-SHA256(secret, `${ts}.${rawBody}`)>.
// Node built-ins only. Prints case ids and status codes — never the secret, signatures, keys or bodies.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { parseArgs } from "node:util";

const USAGE = `send-signed-callback — матриця підписаних колбеків проти роуту колбека n8n

Usage:
  node --env-file=.env.local send-signed-callback.mjs --listen [--port 5678]
  node --env-file=.env.local send-signed-callback.mjs --url <callback url> [--request-key <k>] [--job-id <id>] [--correlation-id <id>]

Режими:
  --listen                Стати «n8n» на http://<host>:<port>/webhook/<event> (замість мока — зупиніть
                          його). Надішліть форму в застосунку: скрипт прийме запуск воркфлоу, відповість
                          202 {"job_id"}, узяти idempotency-key, x-correlation-id і callbackUrl із
                          запиту й прожене матрицю на справжньому записі. Події без callbackUrl
                          отримують 200 і скрипт чекає далі.
  --url <url>             Прогнати матрицю напряму на цей роут (напр. http://127.0.0.1:3000/api/n8n/quote-request).
                          Випадки, яким потрібен справжній запис (valid, replay…), виконуються лише з
                          --request-key / --job-id / --correlation-id, інакше — SKIP.

Options:
  --port <n>              Порт для --listen (за замовчуванням 5678, як n8n).
  --host <addr>           Адреса для --listen (за замовчуванням 127.0.0.1).
  --wait <s>              Скільки чекати запуску в --listen (за замовчуванням 300).
  --request-key <k>       data.requestIdempotencyKey (= idempotency-key запиту застосунку до n8n).
  --job-id <id>           data.jobId (= job_id з відповіді 202, якщо застосунок його зберіг).
  --correlation-id <id>   data.correlationId і x-correlation-id.
  --only <id,id>          Лише ці випадки (див. --list).
  --list                  Показати випадки й очікувані коди.
  --timeout <ms>          Таймаут одного запиту (за замовчуванням 10000).
  -h, --help              Ця довідка.

Environment (секрети — лише зі змінних, ніколи прапорцями):
  N8N_CALLBACK_SECRET     Секрет HMAC колбеків (обов'язково).
  N8N_WEBHOOK_TOKEN       Для --listen: якщо задано, запуск без правильного x-n8n-token отримує 403.

Exit code: 0 — усі випадки дали очікуваний код (SKIP не рахується); 1 — є розбіжність;
2 — помилка запуску (немає секрету, роут недоступний, ніхто не запустив воркфлоу).`;

function usageError(message) {
  console.error(`send-signed-callback: ${message}`);
  process.exit(2);
}

let opts;
try {
  ({ values: opts } = parseArgs({
    options: {
      url: { type: "string" },
      listen: { type: "boolean", default: false },
      port: { type: "string", default: "5678" },
      host: { type: "string", default: "127.0.0.1" },
      wait: { type: "string", default: "300" },
      "request-key": { type: "string" },
      "job-id": { type: "string" },
      "correlation-id": { type: "string" },
      only: { type: "string" },
      list: { type: "boolean", default: false },
      timeout: { type: "string", default: "10000" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  }));
} catch (error) {
  usageError(`${error.message}\n\n${USAGE}`);
}

if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

const positiveInt = (name, value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) usageError(`--${name} must be a positive integer`);
  return n;
};
const TIMEOUT_MS = positiveInt("timeout", opts.timeout);
const WINDOW_S = 300;
const SKEW_CASE_S = WINDOW_S + 5; // a few seconds past the window, so request latency cannot flip the result

// ---------------------------------------------------------------------------
// Signing and request building
// ---------------------------------------------------------------------------

const SECRET = process.env.N8N_CALLBACK_SECRET ?? "";
const nowS = () => Math.floor(Date.now() / 1000);
const hmacHex = (secret, text) => createHmac("sha256", secret).update(text).digest("hex");
const sign = (ts, raw, secret = SECRET) => `sha256=${hmacHex(secret, `${ts}.${raw}`)}`;

function envelope(ctx, { event = ctx.bodyEvent, jobId, omitStatus = false, padBytes = 0 }) {
  const data = {
    jobId,
    status: "completed",
    correlationId: ctx.correlationId,
    requestIdempotencyKey: ctx.requestKey,
    result: { documentUrl: `https://files.example.test/n8n/${jobId}.pdf` },
    completedAt: new Date().toISOString(),
  };
  if (omitStatus) delete data.status;
  if (padBytes) data.pad = "x".repeat(padBytes);
  return JSON.stringify({ version: 1, event, data });
}

// A request signed the way n8n signs it. Options override one thing at a time.
function signedRequest(ctx, raw, { jobId, event = ctx.bodyEvent, ts = nowS(), secret, key, url = ctx.url, headers = {} }) {
  return {
    url,
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-n8n-timestamp": String(ts),
      "x-n8n-signature": sign(ts, raw, secret),
      "idempotency-key": key ?? `${jobId}:${event}`,
      "x-correlation-id": ctx.correlationId,
      ...headers,
    },
  };
}

const without = (request, header) => {
  const headers = { ...request.headers };
  delete headers[header];
  return { ...request, headers };
};

// ---------------------------------------------------------------------------
// Cases (order matters: bad-shape → valid → replay share one idempotency key)
// ---------------------------------------------------------------------------

const fresh = () => randomUUID();

const CASES = [
  {
    id: "unknown-event-path",
    title: "невідома подія в шляху",
    expect: 404,
    build: (ctx) => {
      const jobId = fresh();
      const url = ctx.url.replace(/\/[^/]+\/?$/, `/unknown-event-${jobId.slice(0, 8)}`);
      return signedRequest(ctx, envelope(ctx, { jobId }), { jobId, url });
    },
  },
  {
    id: "text-plain",
    title: "content-type text/plain",
    expect: 415,
    build: (ctx) => {
      const jobId = fresh();
      return signedRequest(ctx, envelope(ctx, { jobId }), { jobId, headers: { "content-type": "text/plain" } });
    },
  },
  {
    id: "too-large",
    title: "тіло понад 64 КБ (70 КБ, підписане)",
    expect: 413,
    build: (ctx) => {
      const jobId = fresh();
      return signedRequest(ctx, envelope(ctx, { jobId, padBytes: 70 * 1024 }), { jobId });
    },
  },
  {
    id: "no-timestamp",
    title: "без x-n8n-timestamp (підпис від `.${тіло}` — ловить лише перевірка часу)",
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      return without(signedRequest(ctx, envelope(ctx, { jobId }), { jobId, ts: "" }), "x-n8n-timestamp");
    },
  },
  {
    id: "stale-timestamp",
    title: `час на ${SKEW_CASE_S} с у минулому (вікно ${WINDOW_S} с)`,
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      return signedRequest(ctx, envelope(ctx, { jobId }), { jobId, ts: nowS() - SKEW_CASE_S });
    },
  },
  {
    id: "future-timestamp",
    title: `час на ${SKEW_CASE_S} с у майбутньому`,
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      return signedRequest(ctx, envelope(ctx, { jobId }), { jobId, ts: nowS() + SKEW_CASE_S });
    },
  },
  {
    id: "ms-timestamp",
    title: "час у мілісекундах замість секунд (підписаний)",
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      return signedRequest(ctx, envelope(ctx, { jobId }), { jobId, ts: Date.now() });
    },
  },
  {
    id: "no-signature",
    title: "без x-n8n-signature",
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      return without(signedRequest(ctx, envelope(ctx, { jobId }), { jobId }), "x-n8n-signature");
    },
  },
  {
    id: "wrong-secret",
    title: "підпис іншим секретом",
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      return signedRequest(ctx, envelope(ctx, { jobId }), { jobId, secret: `wrong-${fresh()}` });
    },
  },
  {
    id: "body-only-signature",
    title: "HMAC лише від тіла, без timestamp",
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      const raw = envelope(ctx, { jobId });
      const request = signedRequest(ctx, raw, { jobId });
      return { ...request, headers: { ...request.headers, "x-n8n-signature": `sha256=${hmacHex(SECRET, raw)}` } };
    },
  },
  {
    id: "tampered-body",
    title: "тіло змінене після підпису (1 символ)",
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      const request = signedRequest(ctx, envelope(ctx, { jobId }), { jobId });
      return { ...request, body: request.body.replace(".pdf", ".pdX") };
    },
  },
  {
    id: "reformatted-body",
    title: "той самий JSON, переформатований після підпису",
    expect: 401,
    build: (ctx) => {
      const jobId = fresh();
      const request = signedRequest(ctx, envelope(ctx, { jobId }), { jobId });
      return { ...request, body: JSON.stringify(JSON.parse(request.body), null, 2) };
    },
  },
  {
    id: "no-key",
    title: "без idempotency-key (підпис правильний)",
    expect: 400,
    build: (ctx) => {
      const jobId = fresh();
      return without(signedRequest(ctx, envelope(ctx, { jobId }), { jobId }), "idempotency-key");
    },
  },
  {
    id: "key-not-from-body",
    title: "idempotency-key не з підписаного тіла",
    expect: 400,
    build: (ctx) => {
      const jobId = fresh();
      return signedRequest(ctx, envelope(ctx, { jobId }), { jobId, key: `${fresh()}:${ctx.bodyEvent}` });
    },
  },
  {
    id: "event-mismatch",
    title: "подія в тілі не відповідає шляху",
    expect: 400,
    build: (ctx) => {
      const jobId = fresh();
      const event = "some-other-event.completed";
      return signedRequest(ctx, envelope(ctx, { jobId, event }), { jobId, event });
    },
  },
  {
    id: "malformed-json",
    title: "підписане, але не JSON",
    expect: 400,
    build: (ctx) => {
      const jobId = fresh();
      return signedRequest(ctx, `{"version":1,"event":"${ctx.bodyEvent}","data":`, { jobId });
    },
  },
  {
    id: "bad-shape",
    title: "підписане, без data.status (ключ той самий, що в valid)",
    expect: 400,
    build: (ctx) => signedRequest(ctx, envelope(ctx, { jobId: ctx.jobId, omitStatus: true }), { jobId: ctx.jobId }),
  },
  {
    id: "valid",
    title: "правильний колбек (ключ мав звільнитися після bad-shape)",
    expect: 202,
    needsRecord: true,
    build: (ctx) => {
      ctx.validRequest = signedRequest(ctx, envelope(ctx, { jobId: ctx.jobId }), { jobId: ctx.jobId });
      return ctx.validRequest;
    },
    hint: (got, text) =>
      got === 200 && isDuplicateBody(text)
        ? "duplicate замість 202: ключ не звільнили після 400 на bad-shape (крок 8 контракту) — або цей --job-id уже приймали"
        : got === 200
          ? "успішний колбек має відповідати 202 {\"ok\": true}, не 200"
          : got === 400 || got === 404
            ? "роут не знайшов запис: --listen або правильний --request-key / --job-id / --correlation-id"
            : null,
  },
  {
    id: "replay",
    title: "повтор тих самих байтів і заголовків (Retry On Fail)",
    expect: 200,
    expectDuplicate: true,
    needsRecord: true,
    build: (ctx) => ctx.validRequest,
  },
  {
    id: "replay-resigned",
    title: "той самий ключ і тіло, новий час і підпис",
    expect: 200,
    expectDuplicate: true,
    needsRecord: true,
    build: (ctx) => signedRequest(ctx, ctx.validRequest.body, { jobId: ctx.jobId }),
  },
  {
    id: "get-method",
    title: "GET замість POST",
    expect: 405,
    build: (ctx) => ({ url: ctx.url, method: "GET", headers: {} }),
  },
];

if (opts.list) {
  for (const c of CASES) console.log(`${c.id.padEnd(20)} ${String(c.expect).padEnd(4)} ${c.title}${c.needsRecord ? "  [потрібен запис]" : ""}`);
  process.exit(0);
}

let selected = CASES;
if (opts.only) {
  const ids = opts.only.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = ids.filter((id) => !CASES.some((c) => c.id === id));
  if (unknown.length) usageError(`unknown case(s): ${unknown.join(", ")} (see --list)`);
  selected = CASES.filter((c) => ids.includes(c.id));
  if (selected.some((c) => c.id.startsWith("replay")) && !selected.some((c) => c.id === "valid")) {
    selected = CASES.filter((c) => c.id === "valid" || ids.includes(c.id));
  }
}

if (!SECRET) usageError("N8N_CALLBACK_SECRET is not set (run with --env-file=.env.local)");
if (opts.listen === Boolean(opts.url)) usageError("use exactly one of --listen or --url (see --help)");

// ---------------------------------------------------------------------------
// Running the matrix
// ---------------------------------------------------------------------------

// node:http with agent: false (one connection per request, closed afterwards) instead of fetch:
// fetch's keep-alive sockets make process.exit() abort on Windows (libuv assertion, exit code 127).
function send(request) {
  const started = Date.now();
  return new Promise((done) => {
    const target = new URL(request.url);
    const body = request.body === undefined ? undefined : Buffer.from(request.body);
    const headers = body ? { ...request.headers, "content-length": String(body.length) } : request.headers;
    const failed = (error) => done({ status: null, error: error.code ?? error.name, ms: Date.now() - started });
    const client = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      { method: request.method, headers, agent: false, signal: AbortSignal.timeout(TIMEOUT_MS) },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8"), ms: Date.now() - started }));
        res.on("error", failed);
      },
    );
    client.on("error", failed);
    client.end(body);
  });
}

function isDuplicateBody(text) {
  try {
    return JSON.parse(text)?.duplicate === true;
  } catch {
    return false;
  }
}

async function runMatrix(ctx) {
  const target = new URL(ctx.url);
  console.log(
    `send-signed-callback · ${target.origin}${target.pathname} · body event ${ctx.bodyEvent} · ` +
      `${selected.length} випадків · запис: ${ctx.hasRecord ? "так" : "ні (випадки з [потрібен запис] — SKIP)"}`,
  );
  let ok = 0;
  let bad = 0;
  let skipped = 0;
  let unreachable = 0;
  for (const c of selected) {
    if (c.needsRecord && !ctx.hasRecord) {
      skipped++;
      console.log(`SKIP ${c.id.padEnd(20)} expected ${c.expect}  — потрібен запис (--listen або --request-key …)`);
      continue;
    }
    const request = c.build(ctx);
    const result = await send(request);
    if (result.status === null) {
      bad++;
      unreachable++;
      console.log(`FAIL ${c.id.padEnd(20)} expected ${c.expect}  got ${result.error} in ${result.ms} ms  ${c.title}`);
      continue;
    }
    const duplicateMissing = c.expectDuplicate && result.status === c.expect && !isDuplicateBody(result.text);
    const good = result.status === c.expect && !duplicateMissing;
    if (good) ok++;
    else bad++;
    const extra = [];
    if (duplicateMissing) extra.push('тіло без "duplicate": true');
    const hint = good ? null : c.hint?.(result.status, result.text);
    if (hint) extra.push(hint);
    if (!good && result.text) extra.push(`відповідь: ${result.text.replace(/\s+/g, " ").slice(0, 80)}`);
    console.log(
      `${good ? "OK  " : "FAIL"} ${c.id.padEnd(20)} expected ${c.expect}  got ${result.status} in ${result.ms} ms  ${c.title}` +
        (extra.length ? `\n       ${extra.join(" · ")}` : ""),
    );
  }
  console.log(`\n${ok} OK, ${bad} FAIL, ${skipped} SKIP → exit ${bad ? (unreachable === bad && ok === 0 ? 2 : 1) : 0}`);
  return bad ? (unreachable === bad && ok === 0 ? 2 : 1) : 0;
}

function contextFor({ url, webhookEvent, requestKey, jobId, correlationId, hasRecord }) {
  const pathEvent = webhookEvent ?? new URL(url).pathname.split("/").filter(Boolean).pop();
  return {
    url,
    bodyEvent: `${pathEvent}.completed`,
    // A real record given only by --correlation-id: send no requestIdempotencyKey, so the route can
    // fall back to correlationId instead of missing on an invented key (JSON.stringify drops undefined).
    requestKey: requestKey ?? (hasRecord && correlationId ? undefined : fresh()),
    jobId: jobId ?? fresh(),
    correlationId: correlationId ?? fresh(),
    hasRecord,
  };
}

// ---------------------------------------------------------------------------
// --url: run directly
// ---------------------------------------------------------------------------

if (opts.url) {
  let parsed;
  try {
    parsed = new URL(opts.url);
  } catch {
    usageError("--url must be an http(s) URL");
  }
  if (!/^https?:$/.test(parsed.protocol)) usageError("--url must be an http(s) URL");
  const hasRecord = Boolean(opts["request-key"] || opts["job-id"] || opts["correlation-id"]);
  const code = await runMatrix(
    contextFor({
      url: opts.url,
      requestKey: opts["request-key"],
      jobId: opts["job-id"],
      correlationId: opts["correlation-id"],
      hasRecord,
    }),
  );
  process.exit(code);
}

// ---------------------------------------------------------------------------
// --listen: behave like n8n's Webhook (Header Auth + Respond to Webhook 202), then run the matrix
// ---------------------------------------------------------------------------

const PORT = positiveInt("port", opts.port);
const WAIT_S = positiveInt("wait", opts.wait);
const TOKEN = process.env.N8N_WEBHOOK_TOKEN ?? "";
const log = (message) => console.log(`[listen] ${message}`);

function sameSecret(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const trigger = await new Promise((resolveTrigger) => {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", `http://${opts.host}:${PORT}`);
      const match = url.pathname.match(/^\/(webhook|webhook-test)\/([^/]+)\/?$/);
      if (!match) return reply(res, 404, { code: 404, message: "Not found" });
      const [, kind, event] = match;
      if (kind === "webhook-test") {
        log(`${req.method} ${url.pathname} -> 404 (тестовий URL: у коді має бути /webhook/)`);
        return reply(res, 404, { code: 404, message: `The requested webhook "${event}" is not registered.` });
      }
      if (req.method !== "POST") return reply(res, 404, { code: 404, message: "This webhook is not registered for this method." });

      const auth = TOKEN
        ? typeof req.headers["x-n8n-token"] === "string" && sameSecret(req.headers["x-n8n-token"], TOKEN)
          ? "ok"
          : req.headers["x-n8n-token"] === undefined ? "missing" : "wrong"
        : "none";
      const present = (h) => (typeof req.headers[h] === "string" && req.headers[h] !== "" ? "present" : "absent");
      const summary = `auth=${auth} idempotency-key=${present("idempotency-key")} x-correlation-id=${present("x-correlation-id")}`;
      if (auth === "missing" || auth === "wrong") {
        log(`POST ${url.pathname} -> 403 ${summary}`);
        return reply(res, 403, { code: 403, message: "Authorization data is wrong!" });
      }

      let envelopeIn = null;
      try {
        envelopeIn = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        envelopeIn = null;
      }
      const callbackUrl = typeof envelopeIn?.callbackUrl === "string" ? envelopeIn.callbackUrl : null;
      const envelopeNote = envelopeIn?.version === 1 && envelopeIn?.event === event ? "envelope=ok" : "envelope=not-v1-or-event-mismatch";
      if (!callbackUrl || !/^https?:\/\//.test(callbackUrl)) {
        log(`POST ${url.pathname} -> 200 ${summary} ${envelopeNote} callbackUrl=absent (подія «до відома», чекаю далі)`);
        return reply(res, 200, { message: "Workflow was started" });
      }

      const jobId = randomUUID();
      log(`POST ${url.pathname} -> 202 ${summary} ${envelopeNote} callbackUrl=present job_id видано`);
      reply(res, 202, { job_id: jobId });
      server.close();
      resolveTrigger({
        event,
        callbackUrl,
        jobId,
        requestKey: typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined,
        correlationId: typeof req.headers["x-correlation-id"] === "string" ? req.headers["x-correlation-id"] : undefined,
      });
    });
  });
  server.on("error", (error) => usageError(`cannot listen on ${opts.host}:${PORT}: ${error.code ?? error.message} (зупиніть мок n8n?)`));
  server.listen(PORT, opts.host, () =>
    log(`слухаю http://${opts.host}:${PORT}/webhook/<event> (Header Auth: ${TOKEN ? "on" : "off"}); надішліть форму — чекаю ${WAIT_S} с`),
  );
  const waitTimer = setTimeout(() => usageError(`за ${WAIT_S} с ніхто не запустив воркфлоу з callbackUrl`), WAIT_S * 1000);
  server.on("close", () => clearTimeout(waitTimer));
});

if (!trigger.requestKey) log("УВАГА: у запиті немає idempotency-key — порушення контракту; data.requestIdempotencyKey буде випадковим");
if (!trigger.correlationId) log("УВАГА: у запиті немає x-correlation-id — порушення контракту");

// Give the app a moment to finish its own after() work, like a short workflow would.
await new Promise((r) => setTimeout(r, 500));
const code = await runMatrix(
  contextFor({
    url: trigger.callbackUrl,
    webhookEvent: trigger.event,
    requestKey: trigger.requestKey,
    jobId: trigger.jobId,
    correlationId: trigger.correlationId,
    hasRecord: true,
  }),
);
process.exit(code);
