# A/B-перевірка скіла `integrating-n8n-webhooks` (Task D)

Протокол — `materials/ab-task.md`, команди — `docs/walkthrough.md`, Task D. **A — без скіла, B — зі
скілом.** Числа й цитати взято з журналів сесій, мока й сервера. Сесії прогонів:
A — `local_1ffff69b…` (тека `leaddesk-ab-a`), B — `local_34481d99…` (тека `leaddesk-ab-b`).

- **Інструмент і версія:** Claude Code 2.1.280, десктопний застосунок (вкладка Code), Windows 11
- **Модель і рівень міркування, однакові в обох прогонах:** `claude-opus-5-5`, effort `xhigh`
  (з метаданих обох сесій)
- **Код:** BASE = `828045c` (коміт після Task C: виправлення Task A, форма нотаток з Task B, три
  скіли; ще без `/quotes` і змін у виклику n8n). Скіл `integrating-n8n-webhooks` для копії B — з
  тодішнього HEAD `b239f7b`, у ньому скіл той самий, що в BASE
- **Копії:** `../leaddesk-ab-a` (без жодного скіла) і `../leaddesk-ab-b` (лише
  `integrating-n8n-webhooks`). У кожній — коміт `start` з тегом `base` (A `2ecbbd4`, B `4ee029e`),
  `npm install` за `package-lock.json` (lock не змінився)
- **Що видалено з обох копій:** `tools/`, `materials/`, `docs/`, `README.md`, `.coderabbit.yaml`,
  `.github/` і всі скіли (у B повернуто лише `integrating-n8n-webhooks`). Перевірка з кроку 1:
  `find … -name SKILL.md` → рівно один рядок (`../leaddesk-ab-b/.claude/skills/integrating-n8n-webhooks/SKILL.md`),
  «no hints - ok», «no contract - ok»; `diff -rq` копій → `Only in ../leaddesk-ab-b/.claude: skills`.
  В обох лишився `skills-lock.json` (лише запис про `vercel-react-best-practices`, контракту в ньому
  немає)
- **Особисті скіли:** `~/.claude/skills/find-skills` на час прогонів перенесено в
  `~/.claude/skills-disabled/` (він уміє шукати й ставити скіли з інтернету), після прогонів
  повернуто. `~/.cursor/skills`, `~/.agents/skills` — немає; `~/.codex/skills/ui-design` — лише для
  Cursor, до n8n не стосується
- **Запит:** текст між лініями `materials/ab-task.md` без змін, нова сесія на кожен прогін
- **Відповідь на уточнення:** агенти нічого не питали й не просилися читати поза текою копії
- **Мок, однаковий для обох** (з робочого репозиторію, термінал у теці копії). На :5678 працював
  чужий мок (запущений о 16:23 з PowerShell, не зупиняла), тому скрізь використано :5679 і застосунок
  на :3001. `APP_BASE_URL` і URL вебхука в `.env.local` копій — на ці ж порти:
  ```bash
  npm run build && npx next start -p 3001
  node --env-file=.env.local ../2026-quitcode-04-agent-skills-hw-v2/tools/mock-n8n.mjs --mode respond-202 --delay 5000 --port 5679
  #   A: + --callback-url http://127.0.0.1:3001/api/quotes/callback   (A не передає callbackUrl)
  ```
  `.env.local` копії: змінні, які додав агент, зі значеннями для мока (секрети згенеровано, значень
  не друкувала), плюс `N8N_WEBHOOK_TOKEN` і `N8N_CALLBACK_SECRET` для мока з тими самими значеннями,
  що в змінних агента для токена й секрету.
- **Базова лінія `check-contract.mjs` на копії до прогону** (увесь код, без `--changed-since`):
  `8 FAIL, 6 PASS` — C1 (`.env.example:6`), C3, C4, C5, C6, C7, C8 (`app/actions.ts:54`), C13. Це
  старий виклик `lead-created`; в A і B однаково, в оцінку прогонів не йде.
  `--changed-since base` до прогону — `0 FAIL`.
- **Дві версії `check-contract.mjs`.** Прогони оцінено двічі. Версія з BASE мала 14 перевірок.
  Після прогону A її виправлено в коміті `6feb2a9` і доповнено в `bd1b1e3` (15 перевірок, C15). Нижче
  обидва виводи; чому так — у розділі A.

## A — без скіла

- **Які скіли бачив агент** (окрема тимчасова сесія): жодного проєктного. Агент відповів: «У
  `AGENTS.md` сказано, що skills проєкту лежать у `.claude/skills/`. У моєму списку їх немає». Решта
  — вбудовані скіли Claude Code, `anthropic-skills:*`, `airtable:*`, `cowork-plugin-management:*`.
- **Що зробив агент.** Форму `/quotes/new`, Server Action `requestQuote` і модуль
  `lib/quote-workflow.ts`. Server Action зберігає запис і одразу перенаправляє на `/quotes/<id>`, а
  n8n викликає в `after()` з `AbortSignal.timeout(10 000)`. Також колбек `POST /api/quotes/callback`,
  сторінку статусу з автооновленням і дедлайном 5 хв, а rate limit (5 запитів за 10 хв з IP) додав
  сам. Контракт вигадав власний:
  - `N8N_QUOTE_WEBHOOK_URL` з тестовим URL, `Authorization: Bearer <N8N_QUOTE_WEBHOOK_TOKEN>`;
  - тіло `{quoteId, company, email, description, budget, budgetLabel, requestedAt}`;
  - режим Webhook «Respond: Immediately»;
  - колбек з `Authorization: Bearer <N8N_QUOTE_CALLBACK_SECRET>` і тілом `{quoteId, status, pdfUrl}`;
  - `callbackUrl` у запиті «навмисно не передається».
- **Звідки агент узяв домовленості.** З наявного коду (патерн `lib/lead-form.ts` / `lib/note-form.ts`,
  змінна `N8N_WEBHOOK_URL=…/webhook-test/lead-created` з `.env.example` — звідси й тестовий URL),
  з документації Next.js 16 у `node_modules` (`after`, forms, `connection()`) і із загальних знань.
  Контракту команди в сесії немає: `x-n8n-token`, HMAC, `idempotency-key` не трапляються жодного
  разу. Для самоперевірки агент написав власний мок у scratchpad.
- **Запитання агента:** не було. **Фінальна відповідь** (скорочено): «Готово: сторінки `/quotes/new` і
  `/quotes/[id]`, Server Action і ендпоінт для n8n працюють… Я не знаю, які поля очікує вже
  опублікований воркфлоу `quote-request`, тому описав свій формат. Його треба узгодити з
  налаштуваннями у клієнта». Окремо агент позначив: `updateLeadStatus` і `deleteLead` не перевіряють
  сесію (створив картку задачі). Це закрито на гілці окремим комітом `c6b04fa` `fix(server-auth-actions)`.
- **Змінені файли** (`git diff --cached --stat base`): 13 файлів, +766 / −1 — `.env.example`,
  `app/api/quotes/callback/route.ts`, `app/quotes/[id]/page.tsx`, `app/quotes/new/actions.ts`,
  `app/quotes/new/page.tsx`, `components/quote-auto-refresh.tsx`, `components/quote-form.tsx`,
  `lib/data.ts`, `lib/db.ts`, `lib/quote-form.ts`, `lib/quote-workflow.ts`, `lib/rate-limit.ts`,
  `lib/types.ts`. Діф: [`docs/ab/a-without-skill.diff`](ab/a-without-skill.diff)
- **Змінні середовища, які додав агент:** `N8N_QUOTE_WEBHOOK_URL`
  (`http://127.0.0.1:5678/webhook-test/quote-request`), `N8N_QUOTE_WEBHOOK_TOKEN`,
  `N8N_QUOTE_CALLBACK_SECRET` (порожні в `.env.example`)
- **`check-contract.mjs --root ../leaddesk-ab-a --changed-since base`**, поточна версія (15 перевірок):
  ```
  check-contract · root: ../leaddesk-ab-a · лише зміни після base · 40 файлів коду · 15 перевірок
  C1   FAIL  немає тестового URL вебхука (/webhook-test/)
         .env.example:11  тестовий URL у .env.example — лише /webhook
  C2   PASS  немає NEXT_PUBLIC_N8N_* (секрети n8n не йдуть у браузер)
  C3   FAIL  змінні виклику n8n (N8N_*URL / *WEBHOOK* / *TOKEN) читає лише lib/n8n/client.ts
         lib/quote-workflow.ts:38  N8N_QUOTE_WEBHOOK_URL поза lib/n8n/client.ts — виклик n8n має бути лише там
         lib/quote-workflow.ts:46  N8N_QUOTE_WEBHOOK_TOKEN поза lib/n8n/client.ts — виклик n8n має бути лише там
  C4   FAIL  модуль lib/n8n/client.ts починається з import "server-only"
         lib/quote-workflow.ts:61  n8n викликається, а lib/n8n/client.ts немає
  C5   PASS  кожен fetch до n8n має signal: AbortSignal.timeout(...)
  C6   FAIL  запит до n8n несе x-n8n-token, idempotency-key, x-correlation-id
         lib/quote-workflow.ts:61  немає заголовків: x-n8n-token, idempotency-key, x-correlation-id
  C7   FAIL  тіло до n8n — конверт { version: 1, event, data }
         lib/quote-workflow.ts:61  тіло — JSON.stringify(payload), а не конверт { version: 1, event, data }
  C8   PASS  Server Action не чекає n8n: виклик лише в after(...)
  C9   PASS  колбек-роут читає req.text() до будь-якого JSON.parse
  C10  FAIL  колбек-роут перевіряє HMAC x-n8n-signature через timingSafeEqual, не ===
         app/api/quotes/callback/route.ts:13  не перевіряє HMAC-підпис x-n8n-signature (createHmac) — лише токен чи нічого
  C11  FAIL  колбек-роут перевіряє x-n8n-timestamp і вікно 300 с
         app/api/quotes/callback/route.ts:1  не читає x-n8n-timestamp — немає захисту від повторного відтворення
  C12  PASS  немає export const runtime = "edge"
  C13  FAIL  .env.example: N8N_* є, секрети change-me-…, адреси локальні
         .env.example  немає N8N_WEBHOOK_BASE_URL
         .env.example  немає N8N_WEBHOOK_TOKEN
         .env.example  немає N8N_CALLBACK_SECRET
         .env.example  немає APP_BASE_URL
  C14  PASS  журнали коду n8n без тіл, заголовків, персональних даних, секретів
  C15  FAIL  колбек-роут відсікає повтори за idempotency-key
         app/api/quotes/callback/route.ts:1  не читає idempotency-key — повтори n8n (Retry On Fail) не відсікаються за ключем

  9 FAIL, 6 PASS → exit 1
  ```
  Версія з BASE (14 перевірок) на тому самому коді дала лише `2 FAIL, 12 PASS` (C1 і C13). Решта
  пройшла «порожньо»: скрипт шукав лише `N8N_WEBHOOK_*` і колбек у `app/api/n8n/**`, а A назвав
  змінні `N8N_QUOTE_*` і поклав колбек в `app/api/quotes/callback`. Це вада скіла, виявлена саме цим
  прогоном; виправлено окремим комітом `6feb2a9` (розділ «Перенесення»). На B і шаблонах скіла
  результат не змінився: 0 FAIL.
- **Журнал мока** (форма → колбек → `/quotes/<id>`), три варіанти на тому самому коді A:
  ```
  # A1 — .env.local як у .env.example агента (тестовий URL), мок з Header Auth
  POST /webhook-test/quote-request -> 404 in 5 ms  | headers: accept,accept-language,authorization,content-type,user-agent | body 351 B sha256=63103b07…
  # A2 — URL виправлено на /webhook/ (перезапуск застосунку), той самий мок
  POST /webhook/quote-request -> 403 in 1 ms auth=missing | headers: accept,accept-language,authorization,content-type,user-agent | body 352 B sha256=084a638b…
  # A3 — ще й Header Auth у мока вимкнено (без N8N_WEBHOOK_TOKEN)
  POST /webhook/quote-request -> 202 in 5 ms auth=none idempotency=absent | headers: accept,accept-language,authorization,content-type,user-agent | body 352 B sha256=2cd579b9…
  workflow 4696d341-… running for 5000 ms, then callback event=quote-request.completed
  callback POST http://127.0.0.1:3001/api/quotes/callback -> 401 in 28 ms (try 1/3) event=quote-request.completed body 314 B sha256=9aa99290…
  ```
  Дві причини, чому n8n, налаштований за контрактом, з A не працює. Запуск: `Authorization: Bearer`
  замість `x-n8n-token` → 403. Колбек: підписаний HMAC → роут A чекає Bearer-секрет → 401. Тіло
  запуску (351–352 Б) містить email і опис задачі.
- **Час від «Надіслати» до відповіді форми:** POST Server Action — 318 мс (A1), 329 мс (A2), 228 мс
  (A3). Форма n8n не чекає, одразу перехід на `/quotes/<id>`
- **Що показала `/quotes/<id>`:** A1 і A2 — «Не вдалося підготувати кошторис» (n8n відхилив
  запуск). A3 — «Готуємо кошторис…» і так лишається: колбек відхилено, тож до дедлайну 5 хв статус
  не зміниться
- **Журнал сервера:** лише `db:*` і `quote.trigger_rejected { quoteId, status: 404 | 403 }`. Тіл,
  email, телефонів, токенів і підписів немає (пошук за тестовим email, компанією, описом — 0 збігів)
- **Матриця колбеків** (`send-signed-callback.mjs --url …/api/quotes/callback`, без запису):
  `11 OK, 7 FAIL, 3 SKIP`. OK з кодом 401 тут випадкові: роут відповідає 401 на все без Bearer —
  зокрема й на правильно підписаний колбек n8n, що й показав A3. FAIL: 415, 413, п'ять випадків 400
  отримали 401.

## B — зі скілом

- **Які скіли бачив агент** (окрема тимчасова сесія): проєктний — лише `integrating-n8n-webhooks`.
  Решта — той самий набір, що в A.
- **Чи викликав агент скіл: так, першою дією.** У журналі сесії B одразу після запиту йде
  `(called Skill)`, потім `Base directory for this skill: E:\Homework\Homework4\leaddesk-ab-b\.claude\skills\integrating-n8n-webhooks`
  і текст `SKILL.md`, а вже потім читання коду. Далі агент працював зі скілом:
  - посилається на `references/n8n-setup.md`;
  - код повторює `references/code-templates.md`;
  - запускав `scripts/check-contract.mjs --changed-since HEAD`, копію мока
    `scripts/mock-n8n.mjs` на :5679 і `scripts/send-signed-callback.mjs --listen`.
- **Що зробив агент:**
  - форму `/quotes/new` і Server Action `requestQuote`: запис `queued` з `idempotencyKey` і
    `correlationId`, `after(() => triggerN8n(…))`, повертає `{ status, id }`;
  - `lib/n8n/client.ts` (`server-only`, таймаут 10 с, повтори лише на мережу/5xx з тим самим
    ключем);
  - колбек `app/api/n8n/[event]/route.ts` за 10 кроками контракту;
  - сторінку `/quotes/[id]` з автооновленням 5 с;
  - чотири змінні в `.env.example` і `docs/n8n-integrations.md`.
  
  У n8n ідуть лише `quoteId`, `company`, `description`, `budget`, без email. Старий `lead-created`
  свідомо не чіпав: «зміна даних зламала б воркфлоу клієнта»; створив картку задачі.
- **Запитання агента:** не було. **Фінальна відповідь** (скорочено): «Я зробив сторінку `/quotes/new`
  з формою, Server Action, що запускає `quote-request` у n8n, колбек-ендпоінт і сторінку статусу
  `/quotes/[id]`. Усе перевірив на моку n8n і в браузері… Матриця підписаних колбеків: 21 з 21 OK…
  Воркфлоу клієнта вже опублікований, тому треба звірити його з контрактом».
- **Змінені файли** (`git diff --cached --stat base`): 13 файлів, +815 — `.env.example`,
  `app/api/n8n/[event]/route.ts`, `app/quotes/[id]/page.tsx`, `app/quotes/new/actions.ts`,
  `app/quotes/new/page.tsx`, `components/quote-form.tsx`, `components/quote-status-refresher.tsx`,
  `docs/n8n-integrations.md`, `lib/data.ts`, `lib/db.ts`, `lib/n8n/client.ts`, `lib/quote-form.ts`,
  `lib/types.ts`. Діф: [`docs/ab/b-with-skill.diff`](ab/b-with-skill.diff)
- **Змінні середовища, які додав агент:** `N8N_WEBHOOK_BASE_URL` (`http://127.0.0.1:5678/webhook`),
  `N8N_WEBHOOK_TOKEN` і `N8N_CALLBACK_SECRET` (`change-me-…`), `APP_BASE_URL` (`http://127.0.0.1:3000`)
- **`check-contract.mjs --root ../leaddesk-ab-b --changed-since base`**, поточна версія:
  ```
  check-contract · root: ../leaddesk-ab-b · лише зміни після base · 39 файлів коду · 15 перевірок
  C1   PASS  немає тестового URL вебхука (/webhook-test/)
  C2   PASS  немає NEXT_PUBLIC_N8N_* (секрети n8n не йдуть у браузер)
  C3   PASS  змінні виклику n8n (N8N_*URL / *WEBHOOK* / *TOKEN) читає лише lib/n8n/client.ts
  C4   PASS  модуль lib/n8n/client.ts починається з import "server-only"
  C5   PASS  кожен fetch до n8n має signal: AbortSignal.timeout(...)
  C6   PASS  запит до n8n несе x-n8n-token, idempotency-key, x-correlation-id
  C7   PASS  тіло до n8n — конверт { version: 1, event, data }
  C8   PASS  Server Action не чекає n8n: виклик лише в after(...)
  C9   PASS  колбек-роут читає req.text() до будь-якого JSON.parse
  C10  PASS  колбек-роут перевіряє HMAC x-n8n-signature через timingSafeEqual, не ===
  C11  PASS  колбек-роут перевіряє x-n8n-timestamp і вікно 300 с
  C12  PASS  немає export const runtime = "edge"
  C13  PASS  .env.example: N8N_* є, секрети change-me-…, адреси локальні
  C14  PASS  журнали коду n8n без тіл, заголовків, персональних даних, секретів
  C15  PASS  колбек-роут відсікає повтори за idempotency-key

  0 FAIL, 15 PASS → exit 0
  ```
  Версія з BASE (14 перевірок) — теж `0 FAIL, 14 PASS`.
- **Журнал мока** (форма → колбек → `/quotes/<id>`):
  ```
  header auth: x-n8n-token required (N8N_WEBHOOK_TOKEN is set)
  POST /webhook/quote-request -> 202 in 4 ms auth=ok idempotency=new | headers: accept,accept-language,content-type,idempotency-key,user-agent,x-correlation-id,x-n8n-token | body 328 B sha256=9bf3d5c3…
  workflow 9f45915c-… running for 5000 ms, then callback event=quote-request.completed
  callback POST http://127.0.0.1:3001/api/n8n/quote-request -> 202 in 148 ms (try 1/3) event=quote-request.completed body 382 B sha256=47041d22…
  ```
- **Час від «Надіслати» до відповіді форми:** POST Server Action — 168 мс (клік → сторінка статусу —
  351 мс)
- **Що показала `/quotes/<id>`:** спершу «Готується / Готуємо кошторис…», через ~5 с сама оновилась до
  «Готовий · Кошторис готовий · Завантажити PDF» (посилання `https://files.example.test/n8n/<jobId>.pdf`)
- **Журнал сервера:**
  ```
  n8n.request { event: 'quote-request', correlationId: 'bb5f7690-…', attempt: 1, status: 202, ms: 62, bodyBytes: 328, bodySha256: '9bf3d5c3…' }
  n8n.callback { event: 'quote-request', correlationId: 'bb5f7690-…', status: 202, ms: 122, bodyBytes: 382 }
  ```
  Лише подія, correlation id, код, тривалість, розмір і sha256 тіла; email, компанії, опису, токенів
  і підписів немає (0 збігів).
- **Матриця колбеків** (`send-signed-callback.mjs --listen`, запуск із форми, справжній запис):
  `21 OK, 0 FAIL, 0 SKIP → exit 0`, запис після прогону — «Готовий».

## Порівняння

| Що дивимось | A — без скіла | B — зі скілом |
|---|---|---|
| Скіл викликано | — (скілів немає) | так, `Skill` першою дією; далі `references/` і `scripts/` |
| `check-contract.mjs --changed-since base`: FAIL | **9**: C1, C3, C4, C6, C7, C10, C11, C13, C15 (версія BASE: 2 — C1, C13) | **0** (в обох версіях) |
| URL вебхука | `/webhook-test/quote-request` у `.env.example` | `/webhook` + подія |
| `auth=` / `idempotency=` у журналі мока | 404 на тестовому URL; з `/webhook/` — `auth=missing` → 403; без Header Auth — `auth=none idempotency=absent` | `auth=ok idempotency=new` |
| Колбек дійшов; код відповіді застосунку | лише з `--callback-url` і вимкненим Header Auth; підписаний колбек → **401** | так, з `callbackUrl` запиту → **202** |
| `/quotes/<id>` після сценарію | «Не вдалося…» (A1/A2) або вічне «Готуємо…» (A3) | «Готовий» + PDF |
| Матриця з 21 колбека | 11 OK / 7 FAIL / 3 SKIP (401 на все без Bearer) | 21 / 21 OK |
| Час відповіді форми (POST) | 228–329 мс | 168 мс |
| Що йде в n8n | `quoteId, company, email, description, budget, budgetLabel, requestedAt` без конверта | конверт `{ version, event, data: { quoteId, company, description, budget }, callbackUrl }` |
| Тіла чи персональні дані в журналі сервера | немає | немає |
| Змінених файлів | 13 (+766 / −1) | 13 (+815) |
| Запитання агента | немає | немає |
| Спільне | `after()`, таймаут 10 с, валідація на сервері, 413 на завеликий колбек, журнали без PII | те саме |

## Перенесення прогону B у гілку (фіча)

- **Як переносили:** `git apply --3way docs/ab/b-with-skill.diff` у корені робочого репозиторію
  (гілка на BASE-коді; після BASE — лише коміти скіла й документації). Застосувалося чисто, без змін
  → коміт **`25c47d4`** «feat(quotes): request-a-quote feature carried over from A/B run B».
  `.env.local` і `node_modules` не переносились, нових залежностей немає.
- **Що довелось доробити руками** (кожне — окремим комітом):
  1. `57d25d3` — старий `lead-created` у `app/actions.ts` переведено на контракт: `triggerN8n` з
     `lib/n8n/client.ts` в `after()` разом з аудитом, `idempotency-key` і `x-correlation-id`, у `data` —
     поля форми без IP, user agent і `rawPayload`. Агент B свідомо цього не зробив (зміна даних може
     зламати воркфлоу клієнта) і створив картку задачі. Склад `data` записано в
     `docs/n8n-integrations.md` — його треба звірити з клієнтом.
  2. `090db99`, `8182298` — з `.env.example` прибрано старий `N8N_WEBHOOK_URL=…/webhook-test/lead-created`
     і згадку тестового URL у коментарі.
  3. Після рев'ю за рубрикою: `21f5db3` — ключ ідемпотентності й correlation id `lead-created`
     зберігаються з лідом; `c6b04fa` — `fix(server-auth-actions)` для дій з лідом; `031d1ef` — підсумок
     `role="alert"` для помилок валідації у формі кошторису (прогін B скіла форм не мав);
     `c2db261` — ліміт 5 запитів за 10 хв на IP для `/quotes/new` (кожен запит запускає воркфлоу).
  4. Скіл, «перший бій» (окремі коміти скіла):
     - `6feb2a9` — `check-contract.mjs` бачив лише «правильні» імена, тож на коді A C3–C11 проходили
       порожньо. Тепер він розпізнає змінні `N8N_*URL/TOKEN`, функції з `fetch`, колбек-роут будь-де
       разом з його локальними імпортами. C10 вимагає HMAC; додано C15.
     - `bd1b1e3` — хибний FAIL C8 на оголошенні функції `submitLead`, знайдений під час доведення.

  Чому скіл цього не дав: `SKILL.md` (крок 1) каже перевести старі змінні на `N8N_WEBHOOK_BASE_URL`.
  Але зміна даних наявної події — це зміна того, що отримує вже опублікований воркфлоу клієнта. Агент
  прямо написав, що тому її не чіпав, і лишив рішення людині. Скіл не каже, як бути з наявною подією:
  це його межа.
- **Ключі контракту в `.env.example`:** `N8N_WEBHOOK_BASE_URL=http://127.0.0.1:5678/webhook`,
  `N8N_WEBHOOK_TOKEN=change-me-webhook-token`, `N8N_CALLBACK_SECRET=change-me-callback-secret`,
  `APP_BASE_URL=http://127.0.0.1:3000`; `/webhook-test/` немає. У `.env.local` — ті самі ключі зі
  згенерованими значеннями (`randomBytes(32)`), старий `N8N_WEBHOOK_URL` прибрано.
- **`npm run lint`, `npm run build` на гілці:** без помилок після кожного коміту.
- **`check-contract.mjs` на фінальному коді** (увесь код, без прапорця):
  ```
  $ node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs   # з кореня репозиторію, HEAD
  check-contract · root: E:HomeworkHomework46-quitcode-04-agent-skills-hw-v2 · 40 файлів коду · 15 перевірок
  C1   PASS  немає тестового URL вебхука (/webhook-test/)
  C2   PASS  немає NEXT_PUBLIC_N8N_* (секрети n8n не йдуть у браузер)
  C3   PASS  змінні виклику n8n (N8N_*URL / *WEBHOOK* / *TOKEN) читає лише lib/n8n/client.ts
  C4   PASS  модуль lib/n8n/client.ts починається з import "server-only"
  C5   PASS  кожен fetch до n8n має signal: AbortSignal.timeout(...)
  C6   PASS  запит до n8n несе x-n8n-token, idempotency-key, x-correlation-id
  C7   PASS  тіло до n8n — конверт { version: 1, event, data }
  C8   PASS  Server Action не чекає n8n: виклик лише в after(...)
  C9   PASS  колбек-роут читає req.text() до будь-якого JSON.parse
  C10  PASS  колбек-роут перевіряє HMAC x-n8n-signature через timingSafeEqual, не ===
  C11  PASS  колбек-роут перевіряє x-n8n-timestamp і вікно 300 с
  C12  PASS  немає export const runtime = "edge"
  C13  PASS  .env.example: N8N_* є, секрети change-me-…, адреси локальні
  C14  PASS  журнали коду n8n без тіл, заголовків, персональних даних, секретів
  C15  PASS  колбек-роут відсікає повтори за idempotency-key

  0 FAIL, 15 PASS → exit 0
  ```
- **Сценарій на гілці:** `npm run build && next start -p 3001` (`APP_BASE_URL` і URL вебхука
  перевизначено на 3001/5679 змінними оточення, бо :5678 зайнятий), мок з `.env.local` гілки.
  - `/quotes/new` → POST 156 мс → `/quotes/<id>` «Готується» → колбек `-> 202` → «Готовий».
    Журнал мока: `POST /webhook/quote-request -> 202 … auth=ok idempotency=new`, потім
    `callback POST …/api/n8n/quote-request -> 202`.
  - Форма ліда на `/` (перероблений `lead-created`) → POST 153 мс, «Дякуємо». Журнал мока:
    `POST /webhook/lead-created -> 202 … auth=ok idempotency=new`, заголовки
    `idempotency-key, x-correlation-id, x-n8n-token`.
  - Журнал сервера: `n8n.request` / `n8n.callback` без персональних даних (0 збігів).
- **`docs/n8n-integrations.md`:** рядки `quote-request` (з прогону B) і `lead-created` (оновлено в
  `57d25d3`); відповідальний — «уточнити».

## Висновок

Скіл змінив результат, і це видно з даних, а не з враження. Без скіла агент зробив акуратну,
безпечну за загальними мірками фічу (`after()`, таймаут, `timingSafeEqual`, журнали без PII), але
за власним контрактом. З n8n, налаштованим як домовилась команда, вона не працює: тестовий URL → 404,
Bearer замість `x-n8n-token` → 403, підписаний колбек → 401, тож кошторис ніколи не стає «Готовим».
Домовленості A взяв із наявного коду (звідси й `/webhook-test/`), документації Next.js і загальних
знань. Контракту в його сесії немає жодного разу.

Агент зі скілом першою дією викликав `Skill` і зробив усе за контрактом: 0 FAIL, `auth=ok
idempotency=new`, колбек 202, 21/21 у матриці. Після перенесення довелось доробити лише старий виклик
`lead-created` і рядок у `.env.example`: агент свідомо лишив їх людині.

Сам скіл після прогону змінився. `check-contract.mjs` на «чужому» коді A спершу показав лише 2 FAIL,
бо впізнавав інтеграцію тільки за «правильними» іменами. Тепер він дивиться на зміст, а не на імена
(коміти `6feb2a9`, `bd1b1e3`). Наступний крок для скіла — правило про зміну `data` наявної події:
коротко пояснювати, як перевести її на контракт, і що саме погодити з клієнтом.

## Обмеження

- Прогони запускались паралельно в окремих копіях. За журналами сесій агенти не зверталися до тек
  одне одного й до робочого репозиторію.
- Сценарії з моком ішли на портах 3001 (застосунок) і 5679 (мок), бо :5678 був зайнятий іншим
  процесом. `APP_BASE_URL` і URL вебхука в `.env.local` копій і гілки вказували на ці ж порти.
- Прогони оцінено двома версіями `check-contract.mjs`: з BASE (14 перевірок) і виправленою після
  прогону A (`6feb2a9`, `bd1b1e3`, 15 перевірок). Обидва виводи — у розділах A і B.
