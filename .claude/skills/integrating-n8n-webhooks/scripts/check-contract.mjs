#!/usr/bin/env node
// Static check of a Next.js project against the team's Next.js <-> n8n contract
// (skill integrating-n8n-webhooks). Node built-ins only.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

const USAGE = `check-contract — статична перевірка коду на контракт Next.js ↔ n8n

Usage:
  node check-contract.mjs [--root <dir>] [--changed-since <git-ref>]

Options:
  --root <dir>              Тека проєкту (за замовчуванням — поточна).
  --changed-since <ref>     Лише зміни після <ref>: нові файли (ще не в git) цілком, у наявних —
                            лише додані/змінені рядки (git diff -U0 <ref>). Без прапорця — увесь проєкт.
  -h, --help                Ця довідка.

Що дивиться: *.ts, *.tsx, *.js, *.jsx, *.mjs, *.cjs і .env.example у <root>.
Пропускає: node_modules, .next, .git, .claude, tools, docs, materials, dist, build, out, coverage.
.env.local та інші .env* не читає.

Перевірки (id — PASS/FAIL, для FAIL — файл:рядок):
  C1   немає тестового URL /webhook-test/ у коді й .env.example
  C2   немає змінних NEXT_PUBLIC_N8N_*
  C3   змінні виклику n8n (N8N_*URL / *WEBHOOK* / *TOKEN) читає лише lib/n8n/client.ts
  C4   lib/n8n/client.ts існує, якщо n8n викликається, і починається з import "server-only"
  C5   кожен fetch до n8n має signal: AbortSignal.timeout(...)
  C6   запит до n8n несе x-n8n-token, idempotency-key, x-correlation-id
  C7   тіло — конверт { version: 1, event, data, ... }, а не рядок з бази
  C8   Server Action ("use server") не чекає n8n: виклик лише всередині after(...)
  C9   колбек-роут: req.text() до будь-якого JSON.parse, без req.json()
  C10  колбек-роут: HMAC x-n8n-signature (createHmac) + timingSafeEqual, не === / !==
  C11  колбек-роут: перевіряє x-n8n-timestamp і вікно 300 с
  C12  немає export const runtime = "edge"
  C13  .env.example: потрібні N8N_* є, секрети — change-me-…, адреси — локальні
  C14  журнали коду n8n не містять тіл, заголовків, персональних даних, секретів
  C15  колбек-роут відсікає повтори за idempotency-key

Exit code: 0 — усі PASS; 1 — є FAIL; 2 — помилка запуску.`;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { root: ".", changedSince: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--root") out.root = argv[++i];
    else if (a.startsWith("--root=")) out.root = a.slice(7);
    else if (a === "--changed-since") out.changedSince = argv[++i];
    else if (a.startsWith("--changed-since=")) out.changedSince = a.slice(16);
    else throw new Error(`unknown argument: ${a}`);
    if (out.root === undefined || out.changedSince === undefined) throw new Error(`${a} needs a value`);
  }
  return out;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`check-contract: ${error.message}\n\n${USAGE}`);
  process.exit(2);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const ROOT = resolve(args.root);
if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) {
  console.error(`check-contract: --root ${args.root} is not a directory`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", ".claude", "tools", "docs", "materials",
  "dist", "build", "out", "coverage", ".vercel", ".turbo",
]);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, found);
    } else if (CODE_EXT.test(name) && !name.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

const rel = (full) => relative(ROOT, full).split(sep).join("/");

// Blank out comments (keeps strings and line breaks, so offsets and line numbers stay valid).
function stripComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === "/" && n === "*") {
      out += "  ";
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== q) {
        const step = src[i] === "\\" ? 2 : 1;
        out += src.slice(i, i + step);
        i += step;
      }
      out += src[i] ?? "";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Blank out string contents (template ${...} expressions are kept).
function stripStrings(src) {
  return src
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => `"${" ".repeat(m.length - 2)}"`)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => `'${" ".repeat(m.length - 2)}'`)
    .replace(/`(?:[^`\\]|\\.)*`/g, (m) =>
      m.replace(/(\$\{[^}]*\})|[^`$\n{}]/g, (part, expr) => (expr ? expr : " ")),
    );
}

const files = walk(ROOT).map((full) => {
  const text = readFileSync(full, "utf8").replace(/\r\n/g, "\n");
  const code = stripComments(text);
  return { path: rel(full), text, code, lines: text.split("\n") };
});

const envExamplePath = join(ROOT, ".env.example");
const envExample = existsSync(envExamplePath) ? readFileSync(envExamplePath, "utf8").replace(/\r\n/g, "\n") : null;

const lineAt = (src, index) => src.slice(0, index).split("\n").length;

// Index of the ")" / "}" matching the opener at `open` (skips strings).
function matchClose(src, open) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const stack = [pairs[src[open]]];
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++;
    } else if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return src.length - 1;
}

// ---------------------------------------------------------------------------
// What the project looks like
// ---------------------------------------------------------------------------

const CLIENT_RE = /^(src\/)?lib\/n8n\/client\.(ts|js|mjs)$/;
// Env vars of the Next.js -> n8n call, whatever the agent named them: N8N_*URL / N8N_*WEBHOOK* / N8N_*TOKEN
// (N8N_WEBHOOK_BASE_URL, N8N_QUOTE_WEBHOOK_URL…), read as process.env.X, process.env["X"] or requireEnv("X").
// Callback secrets (N8N_*CALLBACK*, N8N_*SECRET*) belong to the callback side and are excluded.
const TRIGGER_ENV_RE = /(?:process\.env\.|["'`])(N8N_(?!\w*(?:CALLBACK|SECRET))\w*(?:URL|WEBHOOK|TOKEN)\w*)/g;
const CALLBACK_ENV_RE = /(?:process\.env\.|["'`])N8N_\w*(?:CALLBACK|SECRET)\w*/;
const WEBHOOK_PATH_LITERAL_RE = /["'`][^"'`\n]*\/webhook(?:-test)?\/[^"'`\n]*["'`]/;
const touchesTriggerEnv = (f) => new RegExp(TRIGGER_ENV_RE.source).test(f.code);
const clientFile = files.find((f) => CLIENT_RE.test(f.path)) ?? null;

// Files that call n8n directly: the client module, or any file that calls fetch and reads a trigger env var
// or holds an n8n webhook path.
const n8nFetchFiles = files.filter(
  (f) =>
    /\bfetch\s*\(/.test(f.code) &&
    (CLIENT_RE.test(f.path) || touchesTriggerEnv(f) || WEBHOOK_PATH_LITERAL_RE.test(f.code)),
);

function fetchCalls(file) {
  const calls = [];
  for (const m of file.code.matchAll(/\bfetch\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(file.code, open);
    calls.push({ index: m.index, line: lineAt(file.code, m.index), args: file.code.slice(open + 1, close) });
  }
  return calls;
}

// Exported functions that call fetch in those files (triggerN8n, startQuoteWorkflow, ...): calling them = calling n8n.
function exportedFunctionsCalling(file, pattern) {
  const names = [];
  const defs = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/g;
  for (const m of file.code.matchAll(defs)) {
    const brace = file.code.indexOf("{", m.index + m[0].length - 1);
    const end = brace === -1 ? file.code.indexOf("\n", m.index) : matchClose(file.code, brace);
    if (pattern.test(file.code.slice(m.index, end))) names.push(m[1] ?? m[2]);
  }
  return names;
}
const triggerFunctions = [...new Set(n8nFetchFiles.flatMap((f) => exportedFunctionsCalling(f, /\bfetch\s*\(/)))];

// Local modules a file imports ("@/lib/x", "./x"), one level deep — verification often lives in a helper.
const byPath = new Map(files.map((f) => [f.path, f]));
function resolveImport(fromPath, spec) {
  let bases;
  if (spec.startsWith("@/")) bases = [spec.slice(2), `src/${spec.slice(2)}`];
  else if (spec.startsWith(".")) bases = [posix.join(posix.dirname(fromPath), spec)];
  else return null;
  for (const base of bases) {
    for (const suffix of ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"]) {
      const hit = byPath.get(posix.normalize(base + suffix));
      if (hit) return hit;
    }
  }
  return null;
}
function unitOf(file) {
  const modules = [file];
  for (const m of file.code.matchAll(/(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g)) {
    const hit = resolveImport(file.path, m[1]);
    if (hit && !modules.includes(hit)) modules.push(hit);
  }
  return modules;
}

// Callback route: a route handler under app/api/n8n/, or one that (itself or via its local imports) reads a
// callback secret or x-n8n-signature — also when the agent put it elsewhere (app/api/quotes/callback…).
const callbackRoutes = files.filter((f) => {
  if (!/(^|\/)route\.(ts|js)$/.test(f.path)) return false;
  if (/(^|\/)app\/api\/n8n\//.test(f.path)) return true;
  return unitOf(f).some((m) => CALLBACK_ENV_RE.test(m.code) || /x-n8n-signature/i.test(m.code));
});

const usesServer = (f) => /^\s*(["'])use server\1/m.test(f.code.split("\n").slice(0, 5).join("\n"));

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const results = [];
function check(id, title, run) {
  const violations = [];
  const notes = [];
  run((file, line, message) => violations.push({ file, line, message }), (note) => notes.push(note));
  results.push({ id, title, violations, notes });
}

check("C1", "немає тестового URL вебхука (/webhook-test/)", (fail) => {
  for (const f of files) {
    f.code.split("\n").forEach((l, i) => {
      if (/\/webhook-test\b/.test(l)) fail(f.path, i + 1, "тестовий URL n8n — у коді лише /webhook/");
    });
  }
  envExample?.split("\n").forEach((l, i) => {
    if (/webhook-test/.test(l) && !/^\s*#/.test(l)) fail(".env.example", i + 1, "тестовий URL у .env.example — лише /webhook");
  });
});

check("C2", "немає NEXT_PUBLIC_N8N_* (секрети n8n не йдуть у браузер)", (fail) => {
  for (const f of files) {
    f.code.split("\n").forEach((l, i) => {
      if (/NEXT_PUBLIC_N8N/.test(l)) fail(f.path, i + 1, "змінна n8n з префіксом NEXT_PUBLIC_");
    });
  }
  envExample?.split("\n").forEach((l, i) => {
    if (/^\s*NEXT_PUBLIC_N8N/.test(l)) fail(".env.example", i + 1, "змінна n8n з префіксом NEXT_PUBLIC_");
  });
});

check("C3", "змінні виклику n8n (N8N_*URL / *WEBHOOK* / *TOKEN) читає лише lib/n8n/client.ts", (fail) => {
  for (const f of files) {
    if (CLIENT_RE.test(f.path)) continue;
    for (const m of f.code.matchAll(TRIGGER_ENV_RE)) {
      fail(f.path, lineAt(f.code, m.index), `${m[1]} поза lib/n8n/client.ts — виклик n8n має бути лише там`);
    }
  }
});

check("C4", 'модуль lib/n8n/client.ts починається з import "server-only"', (fail, note) => {
  if (!clientFile) {
    for (const f of n8nFetchFiles) fail(f.path, fetchCalls(f)[0]?.line ?? 1, "n8n викликається, а lib/n8n/client.ts немає");
    if (n8nFetchFiles.length === 0) note("n8n не викликається — перевіряти нічого");
    return;
  }
  const firstStatement = clientFile.code.split("\n").findIndex((l) => l.trim() !== "");
  const line = clientFile.code.split("\n")[firstStatement] ?? "";
  if (!/^\s*import\s+["']server-only["'];?\s*$/.test(line)) {
    fail(clientFile.path, firstStatement + 1, 'перший рядок має бути import "server-only"');
  }
});

check("C5", "кожен fetch до n8n має signal: AbortSignal.timeout(...)", (fail, note) => {
  if (n8nFetchFiles.length === 0) return note("fetch до n8n не знайдено");
  for (const f of n8nFetchFiles) {
    for (const call of fetchCalls(f)) {
      if (!/\bsignal\s*:/.test(call.args) || !/AbortSignal\.timeout\s*\(/.test(f.code)) {
        fail(f.path, call.line, "fetch без signal: AbortSignal.timeout(10_000)");
      }
    }
  }
});

check("C6", "запит до n8n несе x-n8n-token, idempotency-key, x-correlation-id", (fail, note) => {
  if (n8nFetchFiles.length === 0) return note("fetch до n8n не знайдено");
  for (const f of n8nFetchFiles) {
    const missing = ["x-n8n-token", "idempotency-key", "x-correlation-id"].filter(
      (h) => !new RegExp(`["'\`]${h}["'\`]`, "i").test(f.code),
    );
    if (missing.length) fail(f.path, fetchCalls(f)[0]?.line ?? 1, `немає заголовків: ${missing.join(", ")}`);
  }
});

check("C7", "тіло до n8n — конверт { version: 1, event, data }", (fail, note) => {
  if (n8nFetchFiles.length === 0) return note("fetch до n8n не знайдено");
  for (const f of n8nFetchFiles) {
    const envelope = /\bversion\s*:\s*1\b/.test(f.code) && /\bevent\b/.test(f.code) && /\bdata\b/.test(f.code);
    for (const call of fetchCalls(f)) {
      const whole = call.args.match(/body\s*:\s*JSON\.stringify\(\s*([A-Za-z_$][\w$.]*)\s*\)/);
      if (whole && !envelope) fail(f.path, call.line, `тіло — JSON.stringify(${whole[1]}), а не конверт { version: 1, event, data }`);
      else if (!envelope) fail(f.path, call.line, "немає конверта { version: 1, event, data }");
    }
  }
});

check("C8", 'Server Action не чекає n8n: виклик лише в after(...)', (fail) => {
  for (const f of files.filter(usesServer)) {
    const ranges = [...f.code.matchAll(/\bafter\s*\(/g)].map((m) => {
      const open = m.index + m[0].length - 1;
      return [open, matchClose(f.code, open)];
    });
    const inside = (i) => ranges.some(([a, b]) => i > a && i < b);
    const calls = [];
    if (n8nFetchFiles.includes(f)) {
      for (const c of fetchCalls(f)) calls.push({ index: c.index, what: "fetch до n8n" });
    }
    for (const name of triggerFunctions) {
      for (const m of f.code.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))) {
        const before = f.code.slice(Math.max(0, m.index - 200), m.index);
        // Skip the function's own declaration and import lines — only calls count.
        if (/(?:function\s+|(?:const|let|var)\s+)$/.test(before)) continue;
        if (!/import[^;]*$/.test(before.split("\n").pop() ?? "")) {
          calls.push({ index: m.index, what: `${name}(...)` });
        }
      }
    }
    for (const c of calls) {
      if (!inside(c.index)) fail(f.path, lineAt(f.code, c.index), `${c.what} у Server Action поза after() — користувач чекає n8n`);
    }
  }
});

// Names of local functions whose body contains `pattern` (to follow helpers like verifySignature()).
function helpersContaining(code, pattern) {
  const names = [];
  const defs = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>)/g;
  for (const m of code.matchAll(defs)) {
    const name = m[1] ?? m[2];
    const brace = code.indexOf("{", m.index + m[0].length - 1);
    const end = brace === -1 ? code.indexOf("\n", m.index) : matchClose(code, brace);
    if (pattern.test(code.slice(m.index, end))) names.push(name);
  }
  return names;
}

function handlerBody(code) {
  const m = code.match(/export\s+(?:async\s+)?function\s+POST\s*\(|export\s+const\s+POST\s*=/);
  if (!m) return null;
  const brace = code.indexOf("{", code.indexOf(")", m.index) === -1 ? m.index : code.indexOf(")", m.index));
  if (brace === -1) return null;
  return { start: brace, end: matchClose(code, brace) };
}

function firstUse(code, body, token, helpers) {
  const part = code.slice(body.start, body.end);
  const res = [token, ...helpers.map((h) => new RegExp(`\\b${h}\\s*\\(`))];
  const hits = res.map((re) => part.search(re)).filter((i) => i >= 0);
  return hits.length ? body.start + Math.min(...hits) : -1;
}

check("C9", "колбек-роут читає req.text() до будь-якого JSON.parse", (fail, note) => {
  if (callbackRoutes.length === 0) return note("колбек-роуту немає — перевіряти нічого");
  for (const f of callbackRoutes) {
    for (const m of f.code.matchAll(/\b(req|request)\s*\.\s*json\s*\(/g)) {
      fail(f.path, lineAt(f.code, m.index), `${m[1]}.json() — тіло треба читати як сирий текст (req.text())`);
    }
    const body = handlerBody(f.code);
    if (!body) {
      fail(f.path, 1, "не знайдено export POST");
      continue;
    }
    // Helpers are followed into the route's local imports (verifySignature() in lib/n8n/verify.ts…).
    const unitCode = unitOf(f).map((m) => m.code).join("\n");
    const textAt = firstUse(f.code, body, /\b(req|request)\s*\.\s*text\s*\(/, []);
    if (textAt === -1) fail(f.path, lineAt(f.code, body.start), "немає await req.text()");
    const parseAt = firstUse(f.code, body, /\bJSON\.parse\s*\(/, helpersContaining(unitCode, /\bJSON\.parse\s*\(/));
    const sigAt = firstUse(f.code, body, /\btimingSafeEqual\s*\(|\bcreateHmac\s*\(/, helpersContaining(unitCode, /\btimingSafeEqual\s*\(|\bcreateHmac\s*\(/));
    if (parseAt !== -1 && (sigAt === -1 || parseAt < sigAt)) {
      fail(f.path, lineAt(f.code, parseAt), "JSON розбирається до перевірки підпису");
    }
  }
});

// The route plus its local imports: where the signature, timestamp and idempotency logic actually live.
const firstLineOf = (f, re) => {
  const at = f.code.search(re);
  return at === -1 ? 1 : lineAt(f.code, at);
};

check("C10", "колбек-роут перевіряє HMAC x-n8n-signature через timingSafeEqual, не ===", (fail, note) => {
  if (callbackRoutes.length === 0) return note("колбек-роуту немає — перевіряти нічого");
  const SIG = /signature|\bsig\b|hmac|digest|expected/i;
  for (const f of callbackRoutes) {
    const unit = unitOf(f);
    const has = (re) => unit.some((m) => re.test(m.code));
    if (!has(/["'`]x-n8n-signature["'`]/i) || !has(/\bcreateHmac\s*\(/)) {
      fail(f.path, firstLineOf(f, /export\s+(?:async\s+)?function\s+POST|export\s+const\s+POST/), "не перевіряє HMAC-підпис x-n8n-signature (createHmac) — лише токен чи нічого");
    }
    if (!has(/\btimingSafeEqual\s*\(/)) fail(f.path, firstLineOf(f, /createHmac|x-n8n-signature/), "немає crypto.timingSafeEqual");
    for (const m of unit.filter((x) => /createHmac|timingSafeEqual|x-n8n-signature/.test(x.code))) {
      stripStrings(m.code).split("\n").forEach((l, i) => {
        for (const c of l.matchAll(/([^\s=!&|(]+)\s*(===|!==|==|!=)\s*([^\s&|)]+)/g)) {
          const [, left, , right] = c;
          if ((SIG.test(left) || SIG.test(right)) && !/\.length\b/.test(left + right)) {
            fail(m.path, i + 1, `порівняння підпису через ${c[2]} — лише timingSafeEqual`);
          }
        }
      });
    }
  }
});

check("C11", "колбек-роут перевіряє x-n8n-timestamp і вікно 300 с", (fail, note) => {
  if (callbackRoutes.length === 0) return note("колбек-роуту немає — перевіряти нічого");
  for (const f of callbackRoutes) {
    const unitCode = unitOf(f).map((m) => m.code).join("\n");
    if (!/["'`]x-n8n-timestamp["'`]/i.test(unitCode)) fail(f.path, 1, "не читає x-n8n-timestamp — немає захисту від повторного відтворення");
    else if (!/\b300\b|5\s*\*\s*60\b/.test(unitCode)) fail(f.path, 1, "немає вікна часу 300 с");
  }
});

check("C15", "колбек-роут відсікає повтори за idempotency-key", (fail, note) => {
  if (callbackRoutes.length === 0) return note("колбек-роуту немає — перевіряти нічого");
  for (const f of callbackRoutes) {
    const unitCode = unitOf(f).map((m) => m.code).join("\n");
    if (!/["'`]idempotency-key["'`]/i.test(unitCode)) {
      fail(f.path, 1, "не читає idempotency-key — повтори n8n (Retry On Fail) не відсікаються за ключем");
    }
  }
});

check("C12", 'немає export const runtime = "edge"', (fail) => {
  for (const f of files) {
    for (const m of f.code.matchAll(/export\s+const\s+runtime\s*=\s*["']edge["']/g)) {
      fail(f.path, lineAt(f.code, m.index), "edge runtime — потрібен Node.js (node:crypto)");
    }
  }
});

check("C13", ".env.example: N8N_* є, секрети change-me-…, адреси локальні", (fail, note) => {
  const usesN8n = n8nFetchFiles.length > 0 || clientFile !== null;
  if (!usesN8n && callbackRoutes.length === 0) return note("n8n у проєкті немає — перевіряти нічого");
  if (envExample === null) return fail(".env.example", 0, "немає .env.example");
  const vars = new Map();
  envExample.split("\n").forEach((l, i) => {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) vars.set(m[1], { value: m[2].trim().replace(/^["']|["']$/g, ""), line: i + 1 });
  });
  const required = ["N8N_WEBHOOK_BASE_URL", "N8N_WEBHOOK_TOKEN"];
  if (callbackRoutes.length > 0 || files.some((f) => /callbackUrl/.test(f.code))) required.push("N8N_CALLBACK_SECRET", "APP_BASE_URL");
  for (const name of required) if (!vars.has(name)) fail(".env.example", 0, `немає ${name}`);
  for (const name of ["N8N_WEBHOOK_TOKEN", "N8N_CALLBACK_SECRET"]) {
    const v = vars.get(name);
    if (v && !v.value.startsWith("change-me")) fail(".env.example", v.line, `${name} — лише change-me-… (значення не друкуємо)`);
  }
  for (const [name, v] of vars) {
    if (/^(N8N_\w*URL|APP_BASE_URL)$/.test(name) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(v.value)) {
      fail(".env.example", v.line, `${name} — лише локальна адреса (127.0.0.1 / localhost)`);
    }
    if (name === "N8N_WEBHOOK_BASE_URL" && !/\/webhook\/?$/.test(v.value)) {
      fail(".env.example", v.line, "N8N_WEBHOOK_BASE_URL має закінчуватися на /webhook");
    }
  }
});

check("C14", "журнали коду n8n без тіл, заголовків, персональних даних, секретів", (fail) => {
  const FORBIDDEN = /(?<![.\w$])(raw|rawBody|body|headers|formData|payload|envelope|lead|data|signature|secret|token|email|phone|fullName|ipAddress|userAgent|req|request)(?![\w$])(?!\s*:)(?!\s*\.\s*(id|length)\b)/;
  const FORBIDDEN_PROP = /\.\s*(body|headers|formData|rawBody|email|phone|fullName|ipAddress|userAgent)(?![\w$])(?!\s*\.\s*length\b)/;
  const n8nFiles = new Set([
    ...n8nFetchFiles.map((f) => f.path),
    ...callbackRoutes.map((f) => f.path),
    ...(clientFile ? [clientFile.path] : []),
    ...files.filter((f) => triggerFunctions.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(f.code))).map((f) => f.path),
  ]);
  for (const f of files.filter((x) => n8nFiles.has(x.path))) {
    const code = stripStrings(f.code);
    for (const m of code.matchAll(/\bconsole\s*\.\s*(log|info|warn|error|debug)\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const argsText = code.slice(open + 1, matchClose(code, open));
      const hit = argsText.match(FORBIDDEN) ?? argsText.match(FORBIDDEN_PROP);
      if (hit) fail(f.path, lineAt(code, m.index), `console.${m[1]}(… ${hit[1]} …) — у журнал лише подія, код, тривалість, розмір, sha256, correlation id`);
    }
  }
});

// ---------------------------------------------------------------------------
// --changed-since: keep only violations on changed lines / new files
// ---------------------------------------------------------------------------

let changed = null;
if (args.changedSince) {
  const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  try {
    const prefix = git("rev-parse", "--show-prefix").trim();
    const strip = (p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);
    changed = { lines: new Map(), newFiles: new Set() };
    let current = null;
    for (const l of git("diff", "-U0", "--no-color", args.changedSince, "--", ".").split("\n")) {
      if (l.startsWith("+++ ")) {
        current = l === "+++ /dev/null" ? null : strip(l.slice(6));
        if (current && !changed.lines.has(current)) changed.lines.set(current, new Set());
      } else if (current && l.startsWith("@@")) {
        const m = l.match(/\+(\d+)(?:,(\d+))?/);
        const start = Number(m[1]);
        const count = m[2] === undefined ? 1 : Number(m[2]);
        for (let n = start; n < start + count; n++) changed.lines.get(current).add(n);
      }
    }
    for (const p of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) {
      changed.newFiles.add(strip(p));
    }
  } catch (error) {
    console.error(`check-contract: --changed-since ${args.changedSince}: git failed (${error.message.split("\n")[0]})`);
    process.exit(2);
  }
  for (const r of results) {
    r.violations = r.violations.filter(
      (v) =>
        changed.newFiles.has(v.file) ||
        (changed.lines.has(v.file) && (v.line === 0 || changed.lines.get(v.file).has(v.line))),
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

results.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
const scope = args.changedSince ? ` · лише зміни після ${args.changedSince}` : "";
console.log(`check-contract · root: ${ROOT}${scope} · ${files.length} файлів коду · ${results.length} перевірок`);
let failed = 0;
for (const r of results) {
  const status = r.violations.length ? "FAIL" : "PASS";
  if (status === "FAIL") failed++;
  const note = !r.violations.length && r.notes.length ? ` (${r.notes.join("; ")})` : "";
  console.log(`${r.id.padEnd(4)} ${status}  ${r.title}${note}`);
  for (const v of r.violations) console.log(`       ${v.file}${v.line ? `:${v.line}` : ""}  ${v.message}`);
}
console.log(`\n${failed} FAIL, ${results.length - failed} PASS → exit ${failed ? 1 : 0}`);
process.exit(failed ? 1 : 0);
