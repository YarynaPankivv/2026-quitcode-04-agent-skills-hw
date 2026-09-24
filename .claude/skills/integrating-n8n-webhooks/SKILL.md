---
name: integrating-n8n-webhooks
description: >-
  Контракт команди для зв'язки Next.js 16 ↔ n8n: виклик вебхука n8n з одного серверного модуля
  (lib/n8n/client.ts, x-n8n-token, idempotency-key, x-correlation-id, конверт { version, event, data,
  callbackUrl }, таймаут 10 с, повтори лише на мережу/5xx/524), асинхронний режим 202 + колбек,
  Route Handler колбека з перевіркою HMAC-підпису, вікна часу й ідемпотентності, журнали без
  персональних даних; мок n8n і check-contract.mjs для перевірки.
  Use when код надсилає щось у n8n чи приймає запит від n8n: форма чи Server Action запускає
  воркфлоу, n8n повертає результат колбеком, змінні N8N_* у .env, рев'ю такого коду.
  Тригери: «надішли в n8n», «запусти воркфлоу», «вебхук n8n», «колбек від n8n», «n8n повідомить,
  коли готово», «заявка не доходить у n8n», «форма чекає n8n», «підпис колбека», «webhook»,
  «callback», «N8N_WEBHOOK».
  Не для: побудови чи зміни воркфлоу в редакторі n8n, експорту/імпорту JSON воркфлоу, коду для
  вузла Code.
metadata:
  owner: studio-nova-dev
  version: "0.1.0"
---

# Next.js ↔ n8n за контрактом команди

Форма запускає воркфлоу в n8n, n8n повідомляє колбеком, що результат готовий. Контракт (URL,
заголовки, підпис, режими, повтори) команда вже узгодила. Відхилятися від нього можна лише
свідомо й письмово (у PR з поясненням), а не тому, що «так згенерувалось».

## Коли застосовувати

- Будь-який виклик n8n з Next.js: нова подія, зміна наявної (наприклад, `lead-created`),
  перенесення виклику з форми в `after()`.
- Ендпоінт, який приймає запит від n8n (колбек), і змінні `N8N_*` / `APP_BASE_URL`.
- Рев'ю такого коду і відповідь на «заявка не доходить», «форма довго думає через n8n».
- **Не** застосовувати: воркфлоу в редакторі n8n, JSON воркфлоу, вузол Code. Саму форму
  (Server Action, `useActionState`, помилки полів) будуємо за `building-client-form`.

## Контракт коротко

| Що | Як у нас |
|---|---|
| Змінні | `N8N_WEBHOOK_BASE_URL` (закінчується на `/webhook`), `N8N_WEBHOOK_TOKEN`, `N8N_CALLBACK_SECRET`, `APP_BASE_URL`. Лише серверні: жодних `NEXT_PUBLIC_N8N_*` |
| Де код виклику | Лише `lib/n8n/client.ts`, перший рядок `import "server-only"`. `fetch` до n8n деінде немає |
| Запит | `POST ${N8N_WEBHOOK_BASE_URL}/<event>` (kebab-case, одна подія — один шлях) |
| Заголовки | `content-type: application/json`, `x-n8n-token`, `idempotency-key` (UUID, один на бізнес-операцію, зберігається з записом), `x-correlation-id` (UUID ланцюжка) |
| Тіло | `{ version: 1, event, data, callbackUrl? }`. У `data` — мінімум для воркфлоу, не рядок з бази |
| Таймаут і повтори | `AbortSignal.timeout(10_000)` на спробу; до 2 повторів (1 с, потім 3 с) лише на мережеву помилку, таймаут, 5xx, 524; той самий `idempotency-key`. 4xx не повторюємо |
| Відповідь n8n | Дивимось лише на код статусу, текст не парсимо |
| Режим | Усе, що може тривати довше за секунди, — асинхронно: 202 `{ job_id }`, результат колбеком. Користувач n8n не чекає |
| Колбек | `POST /api/n8n/<event>` → `app/api/n8n/[event]/route.ts`; `x-n8n-timestamp`, `x-n8n-signature: sha256=<hex HMAC(secret, "${ts}.${rawBody}")>`, `idempotency-key: <data.jobId>:<body.event>` |
| Журнали | Подія, напрям, `x-correlation-id`, код, тривалість, спроба, розмір і sha256 тіла. Ніколи: тіло, ім'я/email/телефон/IP, токен, підпис, секрет, URL з query |

Повний контракт із поясненнями «чому» — [references/contract.md](references/contract.md).

## Як робимо

1. **Змінні.** Додай у `.env.example` чотири змінні: секрети — `change-me-…`, адреси —
   `http://127.0.0.1:5678/webhook` і `http://127.0.0.1:3000`. Справжні значення — лише
   `.env.local`; значень не читай і не виводь. Старі змінні (`N8N_WEBHOOK_URL` з повним шляхом)
   переведи на `N8N_WEBHOOK_BASE_URL` + подію.
2. **Клієнт.** `lib/n8n/client.ts` за шаблоном із
   [references/code-templates.md](references/code-templates.md#libn8nclientts): одна функція
   `triggerN8n(event, data, { idempotencyKey, correlationId, callbackUrl })`, повтори й таймаут
   усередині. `server-only` у Next.js 16 вбудований — пакет не став.
3. **Хто викликає.** Server Action: сесія/права/валідація всередині (`server-auth-actions` зі скіла
   `vercel-react-best-practices`) → зберегти запис зі статусом `queued`, `idempotencyKey` і
   `correlationId` → `after(() => triggerN8n(…))` (`server-after-nonblocking`) → повернути лише
   `{ status, id }`. Не-React клієнт — Route Handler. `runtime = "edge"` — ніколи.
4. **Режим відповіді** обери за [references/response-modes.md](references/response-modes.md):
   «до відома» — Immediately, довге — Respond to Webhook 202 + колбек. Не певен — асинхронно.
5. **Колбек.** `app/api/n8n/[event]/route.ts` строго в порядку 10 кроків:
   404/415 → `await req.text()` → 413 (> 64 КБ) → 401 (час > 300 с) → 401 (HMAC через
   `timingSafeEqual`) → застовпити `idempotency-key` (повтор → 200 `{ duplicate: true }`) →
   `JSON.parse` і перевірка форми, події й ключа проти тіла → 400 → зберегти стан (на помилці —
   звільнити ключ) → 202 `{ ok: true }` → повільне в `after()`. Шаблон і пояснення —
   [references/code-templates.md](references/code-templates.md#appapin8neventroutets).
6. **n8n-сторона й реєстр.** Налаштування вузлів передай людині текстом за
   [references/n8n-setup.md](references/n8n-setup.md) і додай рядок у `docs/n8n-integrations.md`
   проєкту.
7. **Перевір** `scripts/check-contract.mjs` і моком (розділ Verify). Пастки, на які вже
   наступали, — [references/pitfalls.md](references/pitfalls.md).

## Чекліст

```
- [ ] 1. У коді й .env.example немає /webhook-test/; база URL закінчується на /webhook.
- [ ] 2. Жодної змінної NEXT_PUBLIC_N8N_*; N8N_* читаються лише в серверному коді.
- [ ] 3. fetch до n8n є лише в lib/n8n/client.ts, і в ньому перший рядок — import "server-only".
- [ ] 4. Кожна спроба з AbortSignal.timeout(10_000); повтори ≤ 2, лише мережа/таймаут/5xx/524.
- [ ] 5. Заголовки x-n8n-token, idempotency-key (той самий у повторах), x-correlation-id.
- [ ] 6. Тіло — конверт { version: 1, event, data, callbackUrl? }; data — мінімум, без IP/UA/нотаток.
- [ ] 7. Користувач не чекає на n8n: виклик у after(), дія повертає { status, id }.
- [ ] 8. Колбек-роут читає req.text() до будь-якого JSON.parse / req.json().
- [ ] 9. Підпис: HMAC-SHA256 від `${ts}.${raw}`, порівняння довжин + timingSafeEqual, не ===.
- [ ] 10. Вікно часу 300 с, ліміт 64 КБ, idempotency-key звіряється з data.jobId і event тіла.
- [ ] 11. Стан записано до відповіді 202; при помилці після кроку 6 ключ звільнено.
- [ ] 12. У журналах і відповідях немає тіл, персональних даних, токенів, підписів, URL n8n.
```

## Правила зупинки — зупинись і спитай людину, якщо:

- потрібен **тестовий URL** (`/webhook-test/`) у коді, `.env.example` чи будь-якому закоміченому
  файлі — туди йде лише `/webhook`; тестовий URL людина ставить сама у свій `.env.local`;
- секрет чи токен мав би потрапити в клієнтський код, `NEXT_PUBLIC_*`, query string, журнал,
  відповідь або в git; або задача просить прочитати чи показати значення з `.env.local`;
- задача вимагає, щоб користувач **синхронно чекав** воркфлоу, який може тривати довше за кілька
  секунд (або ти не знаєш, скільки він триває), — пропонуй 202 + колбек, але не вирішуй сам;
- немає сховища з унікальним обмеженням для `idempotency-key` колбеків, а хостинг — serverless
  (пам'ять процесу годиться лише для демо — скажи це людині);
- n8n на боці клієнта налаштований не за контрактом (інший заголовок авторизації, 401 замість 403,
  «JSON using fields» замість Raw, інші шляхи `webhook`) — не підлаштовуйся мовчки;
- у `data` просять покласти весь запис, IP, user agent, внутрішні нотатки чи файли;
- треба змінити воркфлоу в редакторі n8n, імпортувати/експортувати його JSON чи писати вузол Code;
- потрібен новий пакет або зміна `tools/`, `materials/`, CI.

## Verify — задача готова, лише коли:

- [ ] `npm run lint` і `npm run build` без помилок.
- [ ] `node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs` — 0 FAIL, код виходу 0
      (лише свої зміни: `--changed-since <ref>`). FAIL не «обходь» — виправляй код за рядком зі звіту.
- [ ] Мок (з кореня, в окремому терміналі):
      `node --env-file=.env.local .claude/skills/integrating-n8n-webhooks/scripts/mock-n8n.mjs --mode respond-202`.
      Після відправки форми в журналі мока: `POST /webhook/<event> -> 202 … auth=ok idempotency=new`,
      потім `callback POST …/api/n8n/<event> -> 202`.
- [ ] Відповідь форми (DevTools → Network, POST) — сотні мілісекунд, а не час воркфлоу, навіть з
      `--mode last-node`.
- [ ] Матриця колбеків: зупини мок, запусти
      `node --env-file=.env.local .claude/skills/integrating-n8n-webhooks/scripts/send-signed-callback.mjs --listen`
      і надішли форму. Має бути 21 випадок OK (підпис, час, розмір, подія, ідемпотентність, повтори),
      exit 0, запис після прогону — готовий. FAIL — виправ роут за підказкою, не матрицю.
- [ ] Журнал `npm run dev`/`npm start` після відправки: немає email, імені, телефону, токена,
      підпису (пошук за тестовим email → 0 збігів).

## Файли скіла

- [references/contract.md](references/contract.md) — повний контракт: змінні, запит, повтори,
  колбек крок за кроком, ідемпотентність з обох боків, ліміти, журнали. Читай перед кодом.
- [references/response-modes.md](references/response-modes.md) — режими вузла Webhook, правило
  100 с / 524, тестовий і production URL.
- [references/code-templates.md](references/code-templates.md) — шаблони `lib/n8n/client.ts`,
  Server Action з `after()`, `app/api/n8n/[event]/route.ts`, блок `.env.example`.
- [references/n8n-setup.md](references/n8n-setup.md) — що налаштувати в n8n (словами), реєстр
  `docs/n8n-integrations.md`.
- [references/pitfalls.md](references/pitfalls.md) — розбіжності документації й коду n8n, чужих
  скілів, типові помилки агентів.
- `scripts/check-contract.mjs` — статична перевірка коду на контракт, 15 перевірок `C1`–`C15`
  (тестовий URL, `NEXT_PUBLIC_N8N_*`, один модуль + `server-only`, таймаут, заголовки, конверт,
  `after()`, `req.text()` до `JSON.parse`, HMAC + `timingSafeEqual`, вікно часу, edge,
  `.env.example`, журнали, ідемпотентність колбека). Бачить інтеграцію за змістом, а не лише за
  «правильними» іменами: будь-які `N8N_*URL/TOKEN`, колбек-роут будь-де разом з його локальними
  імпортами. PASS/FAIL з файлом і рядком, exit 1 при FAIL; `--root <тека>`,
  `--changed-since <ref>`, `--help`. Node без залежностей.
- `scripts/send-signed-callback.mjs` — матриця з 21 підписаного колбека проти роуту
  (`--listen`: стає «n8n» на :5678, приймає запуск із форми й бере справжні ключі; `--url`:
  напряму). Очікуваний код на кожен випадок, exit 1 при розбіжності; секрети — лише зі змінних,
  `--help`, `--list`.
- `scripts/mock-n8n.mjs` — офлайн-мок n8n (Webhook, Header Auth, режими, підписаний колбек);
  `--help`. Копія `tools/mock-n8n.mjs`, щоб скіл працював і в інших проєктах.
