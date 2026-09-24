# Перевірка (Task A–C, бонус E3)

> Сюди — лише те, що справді сталося: цитати, числа, імена файлів, SHA комітів. Порядок дій — у
> `docs/walkthrough.md`. Прогони A/B і фіча «запит на кошторис» — в окремому звіті
> `docs/ab-validation.md` (Task D).

- **Інструмент і версія, модель:** Claude Code 2.1.280 (десктопний застосунок, вкладка Code) · `claude-opus-5-5`
- **ОС і термінал, Node:** Windows 11 Pro 10.0.26100 · Git Bash · Node v24.15.0 · Next.js 16.3.5 (Turbopack)

## Скіли видно у свіжій сесії

- Як перевіряли: CLI `claude` у цій системі не встановлено (`which claude` → `command not found`),
  тому `claude -p "/context"` запустити не вдалося. Натомість запустили агента з чистим контекстом
  (субагент Claude Code без історії цієї розмови) з запитом «які skills тобі доступні? не
  відкривай файлів» — перед будь-яким читанням файлів. Список скілів у головній сесії той самий.

| Skill | Звідки (Project / Personal / вбудований) | Примітка |
|---|---|---|
| `vercel-react-best-practices` | Project (`.claude/skills/`) | Видно; субагент викликав його через інструмент `Skill` для рев'ю нижче |
| `building-client-form` | — | Буде в Task B |
| `integrating-n8n-webhooks` | — | Буде в Task C |

- Особисті скіли, які теж видно: `find-skills` у `~/.claude/skills/` (пошук і встановлення скілів).
  На рев'ю продуктивності не впливає, але його видно й у свіжій сесії — перед прогоном A в Task D
  це треба врахувати (див. протокол A/B). Решта у списку — скіли плагінів (`airtable:*`,
  `anthropic-skills:*`, `cowork-plugin-management:*`) і вбудовані (`code-review`, `simplify`,
  `security-review`, `init`, `run`…); до React/Next.js продуктивності жоден із них не стосується.

## Task A — виправлення за скілом Vercel

### Рев'ю застосунку за скілом

Запит у свіжому контексті (дослівно з `docs/walkthrough.md`):

> Зроби рев'ю app/, components/, lib/ за скілом vercel-react-best-practices. Для кожної проблеми —
> рядок таблиці: файл:рядок | id правила | що не так | виправлення для Next.js 16. Файли не змінюй.

Агент викликав `Skill` → `vercel-react-best-practices`, прочитав 15 файлів `rules/*.md`, файлів не
змінював. Інструкцій, адресованих агенту, у файлах правил не знайшов. Результат (скорочено; колонка
«Що зробили» — наша):

| файл:рядок (на `main`) | id правила | що не так | Що зробили |
|---|---|---|---|
| `app/actions.ts:68`, `:74` | `server-auth-actions` | `updateLeadStatus`/`deleteLead` не перевіряють сесію й належність ліда до workspace | Не продуктивність, а безпека; відкладено до Task B (патерн форми: перевірка сесії в Server Action) |
| `app/dashboard/page.tsx:16-18` | `async-parallel` | три незалежні запити (400 + 1200 + 400 мс) по черзі | **Виправлено**, коміт `8416969`, з числами |
| `components/leads-toolbar.tsx:4` | `bundle-conditional` | `exceljs` статично в бандлі дашборда, хоча потрібен лише для експорту | **Виправлено**, коміт `0aa95a2` |
| `components/leads-toolbar.tsx:6` | `bundle-dynamic-imports` | `SourcesChart` з `recharts` у початковому бандлі, хоча графік прихований | **Виправлено**, коміт `9b42c29` |
| `components/lead-search.tsx:5` | `bundle-barrel-imports` | `import { debounce } from "lodash"` тягне весь CJS-lodash | Не робили (див. нижче) |
| `app/dashboard/leads/[id]/page.tsx:12-15` | `async-dependencies` | `getLead(id)` чекає на `getCurrentUser()`, хоча від нього не залежить | Не робили: виграш ~80 мс на сторінці ліда |
| `app/dashboard/page.tsx:32` → `components/leads-table.tsx:12` | `server-serialization` | у Client Component ідуть повні `Lead` з `rawPayload`, `internalNotes`, IP | **Виправлено**, коміт `954bab6` |
| `app/dashboard/page.tsx:17`, `:29` | `async-suspense-boundaries` | `getLeadStats` (1200 мс) блокує всю сторінку | Не робили; наступний крок, якщо TTFB 1,44 с замало |
| `components/lead-search.tsx:20-24` | `client-swr-dedup` | після гідратації клієнт знову тягне `/api/leads` | Не робили: SWR — новий пакет, а без нього це вже рефакторинг пошуку |
| `lib/data.ts:7`, `:18` | `server-cache-react` | `getCurrentUser` без `cache()`; `getWorkspace` у `cache()`, але з інлайн-об'єктом `{ slug }` — завжди промах | **Виправлено**, коміт `4c0019a` |
| `app/actions.ts:53-63` | `server-after-nonblocking` | відповідь форми чекає n8n і `logAudit` | Не робили: виклик n8n приводимо до контракту в Task D (див. `docs/walkthrough.md`, розділ 0) |
| `components/lead-search.tsx:18`, `:26-45` | `rerender-derived-state-no-effect` | `filtered` — похідний стан у `useState` + ефект | Не робили |
| `components/lead-actions.tsx:11` | `rerender-derived-state-no-effect` | проп `status` скопійовано в `useState` | Не робили |
| `components/leads-table.tsx:17-20` | `js-tosorted-immutable` | сортування з `localeCompare` на кожен рендер | Не робили |

### Виправлення

**Як міряли:** продакшн-збірка (`npm run lint && npm run build && npm start`, порт 3000), після
кожного виправлення — окрема збірка й окремий запуск сервера. Cookie `leaddesk_session=demo-u_olena`
(демо-користувач Olena, workspace Studio Nova, 172 ліди). Мок n8n для замірів дашборда не потрібен.

```bash
C="leaddesk_session=demo-u_olena"; U=http://localhost:3000/dashboard
curl -s -o /dev/null -b "$C" "$U"                                              # прогрів
for i in 1 2 3 4 5; do curl -s -o /dev/null -b "$C" -w "TTFB %{time_starttransfer}s, total %{time_total}s\n" "$U"; done
curl -s  -b "$C" "$U" | wc -c                                                  # HTML, байти
curl -sL -b "$C" -H "RSC: 1" "$U" | wc -c                                      # RSC, байти
curl -s  -b "$C" "$U" | grep -o rawPayload | wc -l                             # те саме для internalNotes, ipAddress
# db-лічильники: рядки "db:<запит>" у журналі npm start рівно за один curl
# клієнтський JS: усі /_next/static/*.js, на які посилається HTML /dashboard, — сума байтів (і gzip -c | wc -c)
```

TTFB — 5 прогонів після прогріву, у таблиці медіана (у дужках — мін…макс).

| Правило (id) | Коміт | Файли | Що змінилось | Було | Стало | Як міряли |
|---|---|---|---|---|---|---|
| `async-parallel` | `8416969` | `app/dashboard/page.tsx` | `getLeads`, `getLeadStats`, `getSourceBreakdown` — через `Promise.all` замість трьох `await` поспіль | TTFB `/dashboard` **2,256 с** (2,253…2,259) | **1,456 с** (1,446…1,459), −0,80 с | `curl -w %{time_starttransfer}`, 5 прогонів |
| `server-cache-react` | `4c0019a` | `lib/data.ts`, `app/dashboard/layout.tsx`, `components/dashboard-header.tsx`, `app/dashboard/page.tsx`, `app/dashboard/leads/[id]/page.tsx` | `getCurrentUser` у `React.cache`; `getWorkspace(slug: string)` замість `getWorkspace({ slug })` | за один GET `/dashboard`: `getUserBySession` **3**, `getWorkspace` **3** | **1** і **1** (на `/dashboard/leads/lead_0001` — теж по 1). TTFB без змін: 1,458 с | лічильники `db:*` у журналі `npm start` за один `curl` |
| `server-serialization` | `954bab6` | `app/dashboard/page.tsx`, `components/leads-table.tsx` | у `LeadsTable` ідуть лише `LeadRow` (`id`, `fullName`, `company`, `status`, `createdAt`) | HTML **424 592 Б**, RSC **315 197 Б**; `rawPayload`/`internalNotes`/`ipAddress` у HTML — по **172** | HTML **111 377 Б** (−74 %), RSC **31 257 Б** (−90 %); ці поля — **0**, `@example.test` у HTML — 0 | `curl \| wc -c`, `curl \| grep -o` |
| `bundle-dynamic-imports` | `9b42c29` | `components/leads-toolbar.tsx` | `SourcesChart` (recharts) — через `next/dynamic` з `ssr: false` у Client Component | JS при відкритті `/dashboard`: **1 871 692 Б** (gzip 538 404), 10 файлів | **1 518 011 Б** (gzip 437 560) | сума `/_next/static/*.js` з HTML сторінки |
| `bundle-conditional` | `0aa95a2` | `components/leads-toolbar.tsx` | `exceljs` — `import()` у `handleExport`, паралельно з `fetch("/api/leads")` | **1 518 011 Б** (gzip 437 560), 10 файлів | **587 222 Б** (gzip 181 747), 9 файлів | те саме |

Разом по дашборду: TTFB 2,256 → 1,438 с (−36 %), HTML 424 592 → 111 057 Б, RSC 315 197 → 31 029 Б,
клієнтський JS при відкритті 1 871 692 → 587 222 Б (−69 %; gzip 538 404 → 181 747 Б).

- **Чому для головного заміру обрали `async-parallel`:** це саме та скарга клієнта («дашборд
  відкривається понад 2 секунди»), і ефект видно одним `curl` без DevTools. Базова лінія 2,256 с
  збігається з сумою затримок у `lib/db.ts`: 100 (сесія) + 100 (workspace) + 400 + 1200 + 400 =
  2200 мс. Після виправлення лишається 100 + 100 + max(400, 1200, 400) = 1400 мс, і заміряли 1,456 с.
- **Решта виправлень — що і чому змінили, як переконались, що не зламали:**
  - `server-cache-react`: layout, шапка й сторінка кожна викликали `getCurrentUser()` і
    `getWorkspace()`. Перший взагалі не був у `cache()`, а другий був, але з інлайн-об'єктом, тож
    `Object.is` щоразу давав промах (правило прямо про це попереджає). Перевірили: сторінка ліда
    `/dashboard/leads/lead_0001` → 200; без cookie `/dashboard` → 307 на `/login` (`redirect` усередині
    `cache` працює).
  - `server-serialization`: окрім розміру, це ще й витік даних — у браузер ішли IP, user-agent,
    внутрішні нотатки й email усіх 172 лідів, хоча таблиця їх не показує. Таблиця на місці: 172 рядки,
    сортування за колонками, клік веде на сторінку ліда.
  - `bundle-dynamic-imports`: у браузері натиснули «Показати графік джерел» — чанк довантажився,
    графік намалювався (6 стовпців за джерелами).
  - `bundle-conditional`: у браузері натиснули «Експорт в Excel» (клік по посиланню-завантаженню
    перехопили в DevTools, щоб не зберігати файл). Після кліку довантажились чанк `exceljs`
    (255 600 Б стиснутого) і `/api/leads`, сформувався `leads-2026-09-24.xlsx` на 18 704 Б з типом
    `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- **Поради скіла, звірені з документацією Next.js 16 і не застосовані або змінені** (докладно — п. 5
  `docs/skill-review.md`):
  - `bundle-barrel-imports` радить `optimizePackageImports`. У Next.js 16.3.5 `recharts` уже є в
    списку «optimized by default», тож для нього порада зайва. `lodash` (CJS) у списку немає, є лише
    `lodash-es`, тож для нашого `import { debounce } from "lodash"` правильна дія — `lodash/debounce`,
    а не конфіг. Не робили: це вже п'яте виправлення, досить.
  - `bundle-dynamic-imports`: приклад скіла ставить `ssr: false` без застережень. У Next.js 16 з
    Server Component це помилка збірки, тому `dynamic()` лежить у `leads-toolbar.tsx`, де вже є
    `"use client"`.
  - `bundle-conditional`: перевірку `typeof window !== 'undefined'` з прикладу скіла не додавали,
    бо `import()` стоїть в обробнику кліку, а він на сервері не виконується.
  - `server-after-nonblocking` у `app/actions.ts`: `after()` у Next.js 16 є, але виклик n8n за
    інструкцією приводимо до контракту в Task D, тож цю пораду тут не застосовували.
- **Якщо виміряне виправлення не змінило чисел — чому:** `server-cache-react` прибрав 4 з 6 запитів
  сесії й workspace, але TTFB не змінився (1,456 → 1,458 с). Документація Next.js 16 пояснює чому:
  «layouts and pages are rendered in parallel» (`01-app/01-getting-started/06-fetching-data.md:460`).
  Дублікати йшли одночасно з основними запитами, а не після них. Тож тут виграш — навантаження на
  базу (у 3 рази менше запитів сесії й workspace на кожне відкриття), а не час.
- **`npm run lint`, `npm run build` після виправлень:** обидва без помилок після кожного з п'яти
  комітів (перевіряли перед кожним заміром).

## Task B — `building-client-form`

- Запит у свіжій сесії (скіл не названо):
  > <запит>
- Чи спрацював скіл і як це видно: <виклик `Skill` з `building-client-form` / читання `SKILL.md` / ні>
- Якщо не з першого разу — що змінили в `description`, і результат другої спроби: <…>
- Що зроблено (файли): <…>
- Пункти Verify зі скіла — результат кожного: <…>

## Task C — `integrating-n8n-webhooks`

Тут скіл лише пакують. Застосовує його агент у прогоні **B** (Task D) — доказ спрацювання, журнал
мока й час відповіді форми — у `docs/ab-validation.md`.

- Що лишили в `SKILL.md`, а що винесли в `references/` (і чому): <…>
- Правила зупинки — перелік: <…>
- SHA коміту зі скілом (BASE для Task D): <…>
- Що скіл змінив у собі після прогонів (коміти й чому): <… або «нічого»>

**`check-contract.mjs` на коді `main`** (id + PASS/FAIL, код виходу):

```
<вивід>
```

**За бажанням: що скрипт побачив на навмисно поганому коді** (яку перевірку ламали, що вона
сказала). До рубрики це не входить, але бали знімає скрипт, який завжди PASS:

```
<вивід>
```

**`check-contract.mjs` на фінальному коді** (після перенесення прогону B — 0 FAIL):

```
<вивід>
```

**Додатково (за бажанням):** матриця колбеків (`send-signed-callback.mjs`): випадок → очікуваний код → отриманий код.

## Task E3 (бонус) — ті самі скіли в Cursor

- Версія Cursor, модель: <…>
- Які скіли Cursor побачив: <…>
- Ті самі запити, що в Task B, і запит із `materials/ab-task.md`: спрацювали скіли чи ні: <…>
- Чим поведінка відрізнялась від Claude Code: <…>
