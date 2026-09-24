# Контракт Next.js ↔ n8n (повний)

Короткий зміст — у `SKILL.md`. Тут — усі значення й причини. Документація Next.js 16 лежить
локально в `node_modules/next/dist/docs/`; посилання на n8n — на docs.n8n.io.

```
Next.js (Server Action / Route Handler)             n8n
  lib/n8n/client.ts ── POST /webhook/<event> ──────▶ Webhook (Header Auth: x-n8n-token)
     x-n8n-token, idempotency-key, x-correlation-id     └─ Remove Duplicates → Respond 202 {job_id}
                                                           … робота воркфлоу …
  app/api/n8n/[event]/route.ts ◀── POST, підписаний ── Crypto (HMAC) → HTTP Request (Raw body)
     x-n8n-timestamp, x-n8n-signature, idempotency-key, x-correlation-id
```

## 1. Змінні середовища

| Змінна | Зміст | Локально (`.env.example`) |
|---|---|---|
| `N8N_WEBHOOK_BASE_URL` | База production-URL, закінчується на `/webhook` (без `/` в кінці) | `http://127.0.0.1:5678/webhook` |
| `N8N_WEBHOOK_TOKEN` | Значення `x-n8n-token` = Value credential Header Auth у n8n | `change-me-webhook-token` |
| `N8N_CALLBACK_SECRET` | Секрет HMAC колбеків = Hmac Secret Crypto credential у n8n | `change-me-callback-secret` |
| `APP_BASE_URL` | Адреса застосунку, яку бачить n8n (для `callbackUrl`) | `http://127.0.0.1:3000` |

- Жодна `N8N_*` не має префікса `NEXT_PUBLIC_`: Next.js вбудовує в клієнтський бандл лише такі
  змінні (`01-app/02-guides/environment-variables.md`). Читаємо їх лише в серверному коді.
- Справжні значення — `.env.local` (git-ignored) і налаштування хостингу. У `.env.example` —
  лише `change-me-…` і локальні адреси, **ніколи** `/webhook-test/`.
- Новий секрет генерує людина:
  `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
- Секрет не йде в query string, Client Component, журнал, відповідь.
- Відсутня змінна на сервері — помилка з назвою змінної (без значень), а не тихий `undefined`
  у URL.

## 2. Виклик вебхука (Next.js → n8n)

**Модуль.** Увесь HTTP до n8n — у `lib/n8n/client.ts`, перший рядок `import "server-only"`
(імпорт з Client Component тоді ламає збірку; у Next.js 16 пакет вбудований, ставити не треба —
`01-app/01-getting-started/05-server-and-client-components.md`).

**URL.** `POST ${N8N_WEBHOOK_BASE_URL}/<event>`, `<event>` — kebab-case (`lead-created`,
`quote-request`). В n8n один вебхук на пару «шлях + метод», тож одна подія — один шлях.

**Заголовки.**

| Заголовок | Значення | Навіщо |
|---|---|---|
| `content-type` | `application/json` | |
| `x-n8n-token` | `N8N_WEBHOOK_TOKEN` | Header Auth; неправильний/відсутній → n8n відповідає **403** |
| `idempotency-key` | `crypto.randomUUID()`, створений **один раз** на бізнес-операцію й збережений разом із записом | n8n (Remove Duplicates) відкидає повтори; при нашому повторі — той самий ключ |
| `x-correlation-id` | UUID ланцюжка дій, зберігається з записом | однаковий у журналах обох систем і в колбеку |

**Конверт.**

```json
{ "version": 1, "event": "quote-request",
  "data": { "quoteId": "q_0042", "company": "Nova Dental", "budget": 1500 },
  "callbackUrl": "http://127.0.0.1:3000/api/n8n/quote-request" }
```

- `version`: нове необов'язкове поле — та сама версія; перейменування/зміна сенсу — `version: 2`,
  і воркфлоу якийсь час приймає обидві.
- `data`: мінімум, який потрібен воркфлоу. Не весь рядок з бази: IP, user agent, внутрішні нотатки,
  сирі дані форми, `rawPayload` n8n не потрібні.
- `callbackUrl`: лише для асинхронних подій, `${APP_BASE_URL}/api/n8n/<event>`.

**Таймаут.** Кожна спроба — `signal: AbortSignal.timeout(10_000)` (по закінченні — `TimeoutError`).
В асинхронному режимі n8n відповідає одразу, тож 10 с без відповіді — це збій, а не «повільний
воркфлоу».

**Повтори.** Максимум 3 спроби (2 повтори), паузи 1 с і 3 с, **лише** для: мережевої помилки,
`TimeoutError`, 5xx, 524. Завжди той самий `idempotency-key`. 4xx не повторюємо й виправляємо:
403 — токен, 404 — воркфлоу не опубліковано або це тестовий URL, 413 — тіло > 16 МБ.

**Відповідь.** Лише код статусу: 200 (Immediately / last node), 202 `{ job_id }` (Respond to
Webhook). Текст не парсимо: документація пише «Workflow got started», код n8n повертає
`{"message":"Workflow was started"}`. `job_id` можна зберегти, але звіряємо колбек за
`idempotency-key`/`correlationId`.

**Хто викликає.**

- UI → Server Action. Це публічний POST-ендпоінт: сесія, права, валідація — всередині
  (`server-auth-actions`). Дія зберігає запис (`status: "queued"`, `idempotencyKey`,
  `correlationId`), викликає n8n у `after()` (`server-after-nonblocking`) і повертає лише
  `{ status, id }`.
- Чому `after()`, а не `await`: користувач не чекає на мережу, а ще Next.js виконує Server
  Actions **по одній на клієнта** — довге очікування блокує наступну дію того ж користувача
  (`01-app/02-guides/server-actions.md`).
- Якщо n8n так і не прийняв запит після всіх спроб — позначити запис (`status: "failed"` чи
  `"queued"` для ручного повтору) і записати в журнал подію, код і `correlationId`.
- Інший сервіс / cron → Route Handler.
- `export const runtime = "edge"` — ніколи: у Next.js 16 edge застарілий, а потрібен `node:crypto`.

## 3. Колбек (n8n → Next.js)

**Ендпоінт.** `POST /api/n8n/<event>` → `app/api/n8n/[event]/route.ts`. Route Handler —
публічний HTTP-ендпоінт, довіряємо лише підпису. Сесії тут немає й не треба.

| Заголовок | Значення |
|---|---|
| `content-type` | `application/json` |
| `x-n8n-timestamp` | Unix-час у **секундах**, коли n8n підписав тіло |
| `x-n8n-signature` | `sha256=<hex HMAC-SHA256(N8N_CALLBACK_SECRET, "${timestamp}.${rawBody}")>` |
| `idempotency-key` | `<data.jobId>:<event з тіла>`, напр. `5f0c…:quote-request.completed` |
| `x-correlation-id` | скопійований із запиту, що запустив воркфлоу |

```json
{ "version": 1, "event": "quote-request.completed",
  "data": { "jobId": "5f0c…", "status": "completed", "correlationId": "9b1e…",
            "requestIdempotencyKey": "c3d4…",
            "result": { "documentUrl": "https://files.example.test/n8n/5f0c….pdf" },
            "completedAt": "2026-09-21T12:00:00.000Z" } }
```

`data.status` — `completed` або `failed` (тоді `error: { code }` замість `result`). Запис
знаходимо за `data.requestIdempotencyKey` (= `idempotency-key` нашого запиту) або
`data.correlationId`. Мок надсилає лише `completed`.

**Порядок обробки — рівно такий:**

| # | Крок | Відповідь |
|---|---|---|
| 1 | `[event]` зі шляху не в списку відомих; `content-type` не `application/json` — **до** читання тіла | 404; 415 |
| 2 | `const raw = await req.text()` — тіло читається один раз. Ні `req.json()`, ні `JSON.parse` до кроку 7: повторна серіалізація змінює байти | — |
| 3 | `Buffer.byteLength(raw) > 64 * 1024` (колбек несе посилання, не файли) | 413 |
| 4 | `x-n8n-timestamp` не число або `abs(now_s - ts) > 300` — у будь-який бік (захист від replay; вікно — наше рішення) | 401 |
| 5 | HMAC від `` `${ts}.${raw}` `` → `sha256=<hex>`; порівняти: спершу довжини, потім `crypto.timingSafeEqual` (кидає на різних довжинах). Не `===` | 401, тіло без подробиць |
| 6 | Застовпити `idempotency-key` (унікальний запис). Вже є | 200 `{"duplicate":true}` |
| 7 | `JSON.parse(raw)`, перевірка форми; `body.event` ∈ дозволених для `[event]` (`<event>.completed` / `.failed`); `idempotency-key === `${data.jobId}:${body.event}`` | 400 |
| 8 | Зберегти мінімальний стан (`status: "ready"`, `documentUrl`) **до** відповіді. Впало на 7–8 — **звільнити** ключ | 4xx/5xx |
| 9 | Відповісти | 202 `{"ok":true}` |
| 10 | Повільне (листи, сповіщення) — `after()` | — |

Чому саме так:

- **Запис до відповіді (8).** Отримавши 2xx, n8n не повторює колбек. Якби критичний запис жив
  лише в `after()` і впав — результат зник би назавжди.
- **Звільнення ключа (8).** Інакше повтор n8n (Retry On Fail) після нашої помилки отримав би
  `{"duplicate":true}`, і результат загубився б.
- **Ключ проти тіла (7).** Заголовок `idempotency-key` підписом не захищений (HMAC лише від
  `ts.raw`). Хто перехопив підписаний колбек, міг би за 300 с надіслати ті самі байти з новим
  ключем. Коли ключ мусить дорівнювати полям підписаного тіла, повтор із тим самим ключем —
  дублікат, з іншим — 400.
- **Сховище ключів** — БД чи KV з унікальним обмеженням. `Map` у пам'яті процесу — лише для
  демо (на serverless обробники не ділять стан); скажи про це людині.
- `data.status === "failed"` — теж 202: це валідна подія, запис переходить у `failed`.

## 4. Ідемпотентність з обох боків

- Next.js → n8n: той самий `idempotency-key` у кожній спробі; в n8n одразу за Webhook —
  Remove Duplicates за цим заголовком.
- n8n → Next.js: Retry On Fail повторює колбек; ми відсікаємо повтори за ключем (крок 6) і
  приймаємо лише ключ, що збігається з тілом (крок 7).
- Дублікати неминучі (і наші повтори, і повтори n8n) — ідемпотентність обов'язкова.

## 5. Журнали й відповіді з помилками

| Пишемо | Ніколи не пишемо |
|---|---|
| подію, напрям (`n8n.request` / `n8n.callback`), `x-correlation-id` | тіло запиту чи відповіді |
| код статусу, тривалість, номер спроби | ім'я, email, телефон, IP, user agent клієнта |
| довжину тіла і його sha256 | токен, підпис, секрет, повний URL n8n чи URL з query |

Відповіді з помилкою — короткі (`{"error":"unauthorized"}`), без стеку, SQL, URL n8n.

## 6. Ліміти

| Ліміт | Значення |
|---|---|
| Тіло запиту до вебхука n8n | 16 МБ (`N8N_PAYLOAD_SIZE_MAX` на self-hosted) → 413 |
| Тіло Server Action | 1 МБ за замовчуванням (`serverActions.bodySizeLimit`) |
| Відповідь вебхука на n8n Cloud | 100 с, далі **524** (воркфлоу працює далі) |
| Тестовий URL | 120 с після «Listen for test event» |
| Колбек у Next.js | 64 КБ, вікно часу 300 с (наше рішення) |

Файли не передаємо — лише посилання.
