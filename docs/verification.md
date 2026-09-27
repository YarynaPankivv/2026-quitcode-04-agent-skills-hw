# Перевірка (Task A–C; бонус — E2, див. `docs/trigger-evals.md`)

> Сюди — лише те, що справді сталося: цитати, числа, імена файлів, SHA комітів. Порядок дій — у
> `docs/walkthrough.md`. Прогони A/B і фіча «запит на кошторис» — в окремому звіті
> `docs/ab-validation.md` (Task D).

- **Інструмент і версія, модель:** Claude Code 2.1.280 (десктопний застосунок, вкладка Code) · `claude-opus-5-5`
- **ОС і термінал, Node:** Windows 11 Pro 10.0.26100 · Git Bash · Node v24.15.0 · Next.js 16.3.5 (Turbopack)

## Скіли видно у свіжій сесії

- Як перевіряли: під час Task A–C команди `claude` у `PATH` не було (`which claude` →
  `command not found`), тому `claude -p "/context"` не запускався. Натомість запустили агента з
  чистим контекстом (субагент Claude Code без історії цієї розмови) з запитом «які skills тобі
  доступні? не відкривай файлів» — перед будь-яким читанням файлів.
- Пізніше, у Task E2, знайшли CLI, який постачається разом із десктопним застосунком
  (`claude.exe` 2.1.280 у теці пакета застосунку; після `/login` працює з Git Bash). Його подія
  `system/init` у headless-сесії з кореня репозиторію перелічує всі три скіли проєкту:
  `building-client-form`, `integrating-n8n-webhooks`, `vercel-react-best-practices`, а також
  особистий `find-skills`. Спрацювання Task B повторно перевірено саме так (див. Task B).

| Skill | Звідки (Project / Personal / вбудований) | Примітка |
|---|---|---|
| `vercel-react-best-practices` | Project (`.claude/skills/`) | Видно; субагент викликав його через інструмент `Skill` для рев'ю нижче |
| `building-client-form` | Project (`.claude/skills/`) | Видно одразу після створення; у свіжому контексті агент сам викликав його через `Skill` (Task B) |
| `integrating-n8n-webhooks` | Project (`.claude/skills/`) | Видно одразу після створення (застосунок показав його в списку доступних скілів). Спрацювання — у прогоні B, Task D |

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
| `app/actions.ts:68`, `:74` | `server-auth-actions` | `updateLeadStatus`/`deleteLead` не перевіряють сесію й належність ліда до workspace | Не продуктивність, а безпека. Відкладено з Task A й виправлено окремим комітом `c6b04fa` `fix(server-auth-actions)`: сесія, належність ліда до workspace, перевірка статусу |
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

Разом по дашборду — **окремий фінальний замір після всіх п'яти комітів** (та сама методика, нова
збірка й новий запуск сервера): TTFB 2,256 → 1,438 с (−36 %), HTML 424 592 → 111 057 Б, RSC 315 197 →
31 029 Б, клієнтський JS при відкритті 1 871 692 → 587 222 Б (−69 %; gzip 538 404 → 181 747 Б). Тому
TTFB і розміри тут трохи відрізняються від рядків таблиці вище: кожен рядок — замір одразу після
свого коміту.

Інші коміти з префіксом `fix(…)` у гілці — не виправлення за правилами Vercel. `fix(n8n)`,
`fix(env)` — доведення перенесеного коду прогону B до контракту (Task D, `docs/ab-validation.md`).
Виправлення за скілом Vercel — лише п'ять комітів `fix(<rule-id>)` із таблиці та `c6b04fa`
`fix(server-auth-actions)`.

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

Скіл: коміт `743ddf7` (`name: building-client-form` = тека; `description` 922 символи з 1024;
192 рядки на момент цього коміту, 201 — після `511ca08`; лише `SKILL.md`). Самоперевірку робили скриптом, а не `claude plugin validate`.

- **Як перевіряли спрацювання (перша перевірка):** як і в Task A, команди `claude` у `PATH` не
  було, тому запустили агента з чистим контекстом (субагент Claude Code без історії розмови). У запиті — лише задача й обмеження
  («не запускай сервер, не комітить, не став пакети, не чіпай tools/ materials/ docs/ .claude/»),
  а в кінці — прохання перелічити виклики інструментів по порядку. Скіл не названо.
- Запит у свіжій сесії (скіл не названо):
  > На сторінці ліда в дашборді (/dashboard/leads/[id]) додай форму «Додати нотатку»: одне текстове
  > поле до 500 символів; нотатка дописується до внутрішніх нотаток ліда.
- **Чи спрацював скіл і як це видно:** так, з першої спроби. Першим викликом агента (до будь-якого
  читання коду) був інструмент `Skill` з `building-client-form`. Далі агент прочитав код і
  документацію Next.js 16 (`after.md`, `forms.md`), і код пішов за патерном скіла: нумеровані кроки
  1–6 у дії, `NoteFormState` з `values`, ті самі `aria-*` і `role`. `description` змінювати не довелося.
- **Що зроблено (файли):** коміт `59101aa`:
  - `lib/note-form.ts` (новий) — `parseNoteForm` (обрізає пробіли; порожньо → помилка; > 500 →
    помилка з числом символів) і тип `NoteFormState`;
  - `app/dashboard/leads/[id]/actions.ts` (новий) — `addLeadNote`: сесія (`getCurrentUser`) →
    валідація → лід у workspace користувача → `db.appendLeadNote` → `after(logAudit)` →
    `revalidatePath` → `{ status: "ok" }`; у `console.error` — лише подія, `leadId` і `error.name`;
  - `components/lead-note-form.tsx` (новий) — `useActionState`, `<label htmlFor>`, `aria-invalid`,
    `aria-describedby`, підсумок `role="alert"`, успіх `role="status"`, кнопка `disabled` під час
    відправки;
  - `lib/db.ts` — `appendLeadNote` (дописує з нового рядка); `app/dashboard/leads/[id]/page.tsx` —
    форма на сторінці, нотатки з `whitespace-pre-line`.

  Після агента ми змінили дві речі. Буквальний перенос рядка в шаблонному рядку в `lib/db.ts`
  замінили на `\n`. І передачу `leadId` через `useActionState(addLeadNote.bind(null, leadId), …)`
  замінили на `<input type="hidden" name="leadId">`, бо з `.bind` форма без JS зависає (див. нижче).
- **Що знайшов Verify у самому скілі:** скіл радив `.bind(null, id)` як рівноправний варіант.
  Перевірка без JS показала, що на Next.js 16.3.5 + React 19.2.8 такий POST (навіть порожній)
  висить: дія виконується (нотатка записалась, аудит пішов), але відповіді немає й за 60 с
  (`curl … HTTP 000 in 60.006s`). З прихованим полем той самий сценарій відповідає за 0,34–0,54 с.
  Скіл виправлено в коміті `511ca08` (v0.1.1): id — лише через hidden input, у Verify додано «не висить».

**Пункти Verify зі скіла — результат кожного** (продакшн-збірка, `npm start`, лід `lead_0002`/`lead_0003`,
користувач Olena):

«Без JS» емулювали так, як відправляє форму браузер з вимкненим JavaScript. Беремо HTML сторінки,
забираємо з `<form>` приховані поля React (`$ACTION_REF_1`, `$ACTION_1:0`, `$ACTION_1:1`,
`$ACTION_KEY`, `leadId`) і відправляємо їх разом із `note` звичайним multipart-POST через `curl` із
заголовком `Origin` (його шле й браузер; без нього Next.js 16 відхиляє Server Action). Сценарії «з JS» —
у вбудованому браузері, поле заповнювали з консолі.

| Пункт Verify | Результат |
|---|---|
| `npm run lint`, `npm run build` | без помилок (після кожної зміни) |
| Порожня відправка, з JS | `role="alert"`: «Перевірте поля: Напишіть текст нотатки»; `aria-invalid="true"`, `aria-describedby="note-error note-hint"`, текст помилки біля поля; підпис `<label for="note">Нотатка</label>` |
| Введене не зникає, з JS | 600 символів (обхід `maxLength`) → «Нотатка задовга: 600 із 500 символів», у полі лишилось 600 символів |
| Порожня відправка, без JS | HTTP 200 за 0,36 с; у HTML той самий `role="alert"` «Напишіть текст нотатки», `aria-invalid="true"` |
| 600 символів, без JS | HTTP 200 за 0,34 с; «Нотатка задовга: 600 із 500 символів»; у `<textarea>` повернулось 600 символів |
| Валідна відправка, без JS | HTTP 200 за 0,54 с; `role="status"` «Нотатку збережено.»; нотатка з'явилась на сторінці ліда |
| Валідна відправка, з JS | `role="status"` «Нотатку збережено.»; поле очищене; кнопка під час відправки — «Зберігаємо…», `disabled`; нотатка в «Внутрішніх нотатках» |
| Дія без сесії: підроблена cookie `demo-u_nobody` (проходить `proxy.ts`, але сесії не існує) | HTTP 303 → `/login`; `db:appendLeadNote` у журналі не з'явився, запису немає — перевірку робить сама дія |
| Дія без cookie | HTTP 307 → `/login` (відрізає вже `proxy.ts`) |
| Відповідь дії | у RSC-відповіді POST рядок результату дії — рівно `1:{"status":"ok"}`. Решта відповіді — оновлена через `revalidatePath` сторінка; `ipAddress`, `userAgent`, `rawPayload`, `workspaceId`, `email`, `phone` — 0 збігів |
| Журнал сервера | відправили нотатку з маркером, email `test.person@example.test` і телефоном; `grep -c -E 'MARKER\|test.person\|111 22 33'` по журналу `npm start` → **0**. У журналі лише лічильники `db:*` |
| Швидкість / `after()` | POST з JS — 531 мс. Послідовні запити в дії: сесія 100 + (workspace ‖ лід) 100 + запис 80 мс, далі перерендер сторінки. `db:insertAuditEntry` (250 мс) у журналі є, але в час відповіді не входить: інакше було б ≥ 780 мс |

Код прогону лишили в гілці: він проходить усі пункти Verify.

**Повторна перевірка в нових headless-сесіях** (27.09.2026, після того як знайшли `claude.exe`; див.
«Скіли видно»). Кожен запит — окрема нова сесія з кореня репозиторію, скіл не названо:

```bash
claude.exe -p --output-format stream-json --verbose --permission-mode default \
  --allowedTools "Skill,Read,Grep,Glob" \
  --disallowedTools "Edit,Write,NotebookEdit,Bash,PowerShell,WebFetch,WebSearch" < prompt.txt > run.jsonl
```

| Запит | Сесія | Перші виклики інструментів | Результат |
|---|---|---|---|
| Той самий, що вище («Додати нотатку»), дослівно | `d6e22c41…` | `Skill(building-client-form)`, `Glob`, `Read`… | Скіл викликано першою дією. Агент побачив, що форма вже є, і звірив її з чеклістом скіла |
| Новий: «На сторінці ліда в дашборді додай форму «Запланувати дзвінок»: дата, час і коментар до 200 символів; запланований дзвінок зберігається в ліді й показується на сторінці» | `9d245e83…` | `Skill(building-client-form)`, `Glob`, `Read`… | Скіл викликано першою дією. Файлів агент не змінив (Edit/Write заборонені) — видав реалізацію текстом |

Модель — `claude-opus-5-5`. Після обох сесій `git status` чистий, файли `run.jsonl` у git немає.

## Task C — `integrating-n8n-webhooks`

Тут скіл лише пакують. Застосовує його агент у прогоні **B** (Task D) — доказ спрацювання, журнал
мока й час відповіді форми — у `docs/ab-validation.md`.

- **Що лишили в `SKILL.md`, а що винесли в `references/` (і чому).** У `SKILL.md` (148 рядків у `d76f038`,
  156 — зараз, після додавання скриптів у «Файли скіла»; `description` 932 символи) лишилось те, що агент має зробити:
  - контракт однією таблицею (змінні, модуль, URL, заголовки, конверт, таймаут/повтори, режим,
    колбек, журнали);
  - 7 кроків із прямими посиланнями на довідку;
  - чекліст на 12 пунктів, правила зупинки й Verify.

  «Чому» й деталі — у `references/`, один рівень, на кожен файл є пряме посилання з `SKILL.md`, між
  собою файли не посилаються:
  - `contract.md` — повний контракт і 10 кроків колбека з причинами;
  - `response-modes.md` — режими, правило 100 с / 524, тестовий і production URL, команди мока;
  - `code-templates.md` — `lib/n8n/client.ts`, Server Action з `after()`, роут колбека, `.env.example`;
  - `n8n-setup.md` — налаштування вузлів словами й реєстр інтеграцій;
  - `pitfalls.md` — розбіжності документації й коду n8n і типові помилки.

  Записку не копіювали: її переструктуровано під того, хто пише код. Шаблони перевірили на копії
  LeadDesk поза гілкою: `tsc` і `eslint` без помилок, 14 підписаних колбеків дали очікувані коди,
  клієнт проти мока поводиться за контрактом (деталі — на початку `code-templates.md`).
- **Правила зупинки:**
  1. тестовий URL `/webhook-test/` у коді, `.env.example` чи іншому закоміченому файлі;
  2. секрет чи токен у клієнтському коді, `NEXT_PUBLIC_*`, query string, журналі, відповіді чи git,
     а також прохання прочитати `.env.local`;
  3. синхронне очікування воркфлоу, який може тривати довше за кілька секунд (або невідомо скільки);
  4. немає сховища з унікальним обмеженням для `idempotency-key` на serverless;
  5. n8n клієнта налаштований не за контрактом (інший заголовок, 401 замість 403, не Raw, інші шляхи);
  6. у `data` просять покласти весь запис, IP, user agent, нотатки чи файли;
  7. треба змінити воркфлоу в n8n, JSON воркфлоу чи вузол Code;
  8. новий пакет або зміни в `tools/`, `materials/`, CI.
- **Правила Vercel** — за id: `server-auth-actions`, `server-after-nonblocking`. Форма — за
  `building-client-form`.
- **SHA коміту зі скілом (BASE для Task D): `828045c`** («skills(integrating-n8n-webhooks): add
  send-signed-callback.mjs callback matrix»). Це другий коміт скіла, поверх `d76f038` («skills: add
  integrating-n8n-webhooks (contract, references, scripts)»); він додає необов'язковий
  `send-signed-callback.mjs`. Код застосунку в обох комітах однаковий. У BASE вже є виправлення
  Task A, усі три скіли, форма нотаток з Task B. Немає ні `/quotes`, ні переробленого виклику n8n:
  `app/actions.ts:54` досі робить старий `fetch`.
- `scripts/mock-n8n.mjs` — байт у байт копія `tools/mock-n8n.mjs` (`cmp` без розбіжностей).
- **Що скіл змінив у собі після прогонів** (коміти й чому; докладно — `docs/ab-validation.md`):
  - `6feb2a9` — `check-contract.mjs` на коді прогону A (без скіла) показав лише 2 FAIL, хоча код
    ігнорує контракт. Скрипт упізнавав інтеграцію тільки за «правильними» іменами (`N8N_WEBHOOK_*`,
    `app/api/n8n/**`), а A назвав змінні `N8N_QUOTE_*` і поклав колбек в `app/api/quotes/callback`
    з Bearer-секретом. Тепер скрипт розпізнає:
    - будь-які `N8N_*URL/WEBHOOK/TOKEN` і рядки `/webhook/`;
    - експортовані функції з `fetch`;
    - колбек-роут будь-де — за колбековим секретом чи `x-n8n-signature`, разом з його локальними
      імпортами.

    C10 тепер вимагає HMAC `x-n8n-signature`, додано **C15** (ідемпотентність колбека за
    `idempotency-key`). Результат: A — 9 FAIL; B, шаблони скіла — як і раніше, 0 FAIL; `main` —
    ті самі 8 FAIL; навмисно поганий код — 15 FAIL.
  - `bd1b1e3` — C8 хибно вважав оголошення `export async function submitLead(` викликом n8n поза
    `after()`. Знайдено, коли доводила перенесений код на гілці.

  Отже, у скрипті тепер **15 перевірок `C1`–`C15`** (вище описано версію з BASE, 14 перевірок).

**`check-contract.mjs`: 15 перевірок `C1`–`C15`** (у BASE `828045c` було 14; C15 і ширше розпізнавання
додано після прогону A — коміти `6feb2a9`, `bd1b1e3`, див. «Що скіл змінив у собі»). Node без залежностей (`node:fs`, `node:path`,
`node:child_process` лише для `--changed-since`). Для кожної — PASS/FAIL, для FAIL — `файл:рядок`
і причина. Exit 1 при FAIL, 2 — помилка запуску (невідомий аргумент, не тека, поганий git-ref).
Є `--root <тека>`, `--changed-since <ref>` і `--help`. Читає код і лише `.env.example`, інших `.env*`
не відкриває; значень змінних не друкує.

**`check-contract.mjs` на коді `main`** (`git archive main | tar -x -C ../leaddesk-main`), поточна
версія скрипта. Версія з BASE дала на тому самому коді ті самі 8 FAIL (`8 FAIL, 6 PASS`): C15 на
`main` не має що перевіряти.

```
$ node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs --root ../leaddesk-main; echo "exit=$?"
check-contract · root: ../leaddesk-main · 28 файлів коду · 15 перевірок
C1   FAIL  немає тестового URL вебхука (/webhook-test/)
       .env.example:6  тестовий URL у .env.example — лише /webhook
C2   PASS  немає NEXT_PUBLIC_N8N_* (секрети n8n не йдуть у браузер)
C3   FAIL  змінні виклику n8n (N8N_*URL / *WEBHOOK* / *TOKEN) читає лише lib/n8n/client.ts
       app/actions.ts:54  N8N_WEBHOOK_URL поза lib/n8n/client.ts — виклик n8n має бути лише там
C4   FAIL  модуль lib/n8n/client.ts починається з import "server-only"
       app/actions.ts:54  n8n викликається, а lib/n8n/client.ts немає
C5   FAIL  кожен fetch до n8n має signal: AbortSignal.timeout(...)
       app/actions.ts:54  fetch без signal: AbortSignal.timeout(10_000)
C6   FAIL  запит до n8n несе x-n8n-token, idempotency-key, x-correlation-id
       app/actions.ts:54  немає заголовків: x-n8n-token, idempotency-key, x-correlation-id
C7   FAIL  тіло до n8n — конверт { version: 1, event, data }
       app/actions.ts:54  тіло — JSON.stringify(lead), а не конверт { version: 1, event, data }
C8   FAIL  Server Action не чекає n8n: виклик лише в after(...)
       app/actions.ts:54  fetch до n8n у Server Action поза after() — користувач чекає n8n
C9   PASS  колбек-роут читає req.text() до будь-якого JSON.parse (колбек-роуту немає — перевіряти нічого)
C10  PASS  колбек-роут перевіряє HMAC x-n8n-signature через timingSafeEqual, не === (колбек-роуту немає — перевіряти нічого)
C11  PASS  колбек-роут перевіряє x-n8n-timestamp і вікно 300 с (колбек-роуту немає — перевіряти нічого)
C12  PASS  немає export const runtime = "edge"
C13  FAIL  .env.example: N8N_* є, секрети change-me-…, адреси локальні
       .env.example  немає N8N_WEBHOOK_BASE_URL
       .env.example  немає N8N_WEBHOOK_TOKEN
C14  PASS  журнали коду n8n без тіл, заголовків, персональних даних, секретів
C15  PASS  колбек-роут відсікає повтори за idempotency-key (колбек-роуту немає — перевіряти нічого)

8 FAIL, 7 PASS → exit 1
exit=1
```

Це ті самі розбіжності, що видно в журналі мока з розділу 0 walkthrough:
- `/webhook-test/` у `.env.example` — 404 після 120 с;
- немає `x-n8n-token` — з токеном у мока буде 403;
- немає `idempotency-key`;
- на n8n іде весь рядок `lead`;
- форма чекає вебхук.

**Що скрипт побачив на навмисно поганому коді** (тимчасова тека `../cc-bad`, після перевірки
видалена). Що в ній лежало:
- `app/api/n8n/[event]/route.ts` — `req.json()`, підпис від `JSON.stringify(body)` без часу,
  `signature === expected`, `export const runtime = "edge"`, `console.log(…, body)`;
- `app/api/n8n/parse-first/route.ts` — `req.text()`, але `JSON.parse(raw)` **до** перевірки підпису
  (сам підпис — через `timingSafeEqual` у хелпері, довжини через `===`, тож це не порушення);
- `lib/n8n/client.ts` — без `server-only`, без таймауту, лише `x-n8n-token`, `JSON.stringify(data)`,
  `console.info(…, res.headers)`;
- `app/quotes/actions.ts` — `"use server"`, `console.log(…, formData)`, `await sendToN8n(…)`;
- `app/quotes/widget.tsx` — `process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL`;
- `.env.example` — зовнішній `…/webhook-test`, «справжній» токен.

```
$ node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs --root ../cc-bad; echo "exit=$?"
check-contract · root: ../cc-bad · 5 файлів коду · 14 перевірок
C1   FAIL  немає тестового URL вебхука (/webhook-test/)
       .env.example:1  тестовий URL у .env.example — лише /webhook
C2   FAIL  немає NEXT_PUBLIC_N8N_* (секрети n8n не йдуть у браузер)
       app/quotes/widget.tsx:2  змінна n8n з префіксом NEXT_PUBLIC_
C3   PASS  N8N_WEBHOOK_* читає лише lib/n8n/client.ts
C4   FAIL  модуль lib/n8n/client.ts починається з import "server-only"
       lib/n8n/client.ts:2  перший рядок має бути import "server-only"
C5   FAIL  кожен fetch до n8n має signal: AbortSignal.timeout(...)
       lib/n8n/client.ts:3  fetch без signal: AbortSignal.timeout(10_000)
C6   FAIL  запит до n8n несе x-n8n-token, idempotency-key, x-correlation-id
       lib/n8n/client.ts:3  немає заголовків: idempotency-key, x-correlation-id
C7   FAIL  тіло до n8n — конверт { version: 1, event, data }
       lib/n8n/client.ts:3  тіло — JSON.stringify(data), а не конверт { version: 1, event, data }
C8   FAIL  Server Action не чекає n8n: виклик лише в after(...)
       app/quotes/actions.ts:6  sendToN8n(...) у Server Action поза after() — користувач чекає n8n
C9   FAIL  колбек-роут читає req.text() до будь-якого JSON.parse
       app/api/n8n/parse-first/route.ts:11  JSON розбирається до перевірки підпису
       app/api/n8n/[event]/route.ts:6  req.json() — тіло треба читати як сирий текст (req.text())
       app/api/n8n/[event]/route.ts:5  немає await req.text()
C10  FAIL  колбек-роут порівнює підпис через timingSafeEqual, не ===
       app/api/n8n/[event]/route.ts:1  немає crypto.timingSafeEqual
       app/api/n8n/[event]/route.ts:10  порівняння підпису через === — лише timingSafeEqual
C11  FAIL  колбек-роут перевіряє x-n8n-timestamp і вікно 300 с
       app/api/n8n/[event]/route.ts:1  не читає x-n8n-timestamp
C12  FAIL  немає export const runtime = "edge"
       app/api/n8n/[event]/route.ts:3  edge runtime — потрібен Node.js (node:crypto)
C13  FAIL  .env.example: N8N_* є, секрети change-me-…, адреси локальні
       .env.example  немає N8N_CALLBACK_SECRET
       .env.example  немає APP_BASE_URL
       .env.example:2  N8N_WEBHOOK_TOKEN — лише change-me-… (значення не друкуємо)
       .env.example:1  N8N_WEBHOOK_BASE_URL — лише локальна адреса (127.0.0.1 / localhost)
       .env.example:1  N8N_WEBHOOK_BASE_URL має закінчуватися на /webhook
C14  FAIL  журнали коду n8n без тіл, заголовків, персональних даних, секретів
       app/api/n8n/[event]/route.ts:11  console.log(… body …) — у журнал лише подія, код, тривалість, розмір, sha256, correlation id
       app/quotes/actions.ts:5  console.log(… formData …) — у журнал лише подія, код, тривалість, розмір, sha256, correlation id
       lib/n8n/client.ts:8  console.info(… headers …) — у журнал лише подія, код, тривалість, розмір, sha256, correlation id

13 FAIL, 1 PASS → exit 1
exit=1
```

C3 тут — PASS, і це правильно: `N8N_WEBHOOK_*` у поганій теці читає лише `lib/n8n/client.ts`.
Кожну з решти 13 перевірок спрацьовано навмисним порушенням.

**Зворотна перевірка — шаблони скіла** (`code-templates.md` + `.env.example` з довідки, тека
`../cc-good`, видалена): `0 FAIL, 14 PASS → exit 0`. Потім по одному ламали правильний код, і кожна
зміна дала свій FAIL:
- прибрали `signal` з `fetch` → `C5 FAIL lib/n8n/client.ts:48`;
- порівняли підпис через `===` → `C10 FAIL route.ts:31` і «немає timingSafeEqual»;
- замінили `after(async () => …)` на `await (async () => …)` → `C8 FAIL app/quotes/actions.ts:24`.

Саме тут знайшлася діра в першій версії скрипта. Шаблон читає змінну через
`process.env[name]`, і скрипт не впізнав клієнт, тож C5–C7 на шаблоні пройшли «порожньо» з приміткою
«fetch до n8n не знайдено». Виправлено до коміту: модуль `lib/n8n/client.ts` і файли з рядком
`N8N_WEBHOOK_*` тепер завжди вважаються викликом n8n.

**`--changed-since`:**
- на гілці `--changed-since main` → 0 FAIL: старі порушення `app/actions.ts:54` і `.env.example:6`
  — не зміни гілки, тому відфільтровані;
- у тимчасовому git-репо з правильним кодом додали рядок з `/webhook-test/` в наявний файл і
  новий, ще не доданий файл з `NEXT_PUBLIC_N8N_TOKEN`. Повна перевірка показала 5 FAIL (включно зі
  старими регресіями), `--changed-since HEAD` — лише 2: `lib/stub.ts:2` і `app/new-file.ts:1`;
- неіснуючий ref → exit 2.

**`check-contract.mjs` на фінальному коді** — HEAD гілки після перенесення прогону B і всіх
доведень (`25c47d4` … `c2db261`); увесь код, без `--changed-since`, з кореня репозиторію:

```
$ node .claude/skills/integrating-n8n-webhooks/scripts/check-contract.mjs; echo "exit=$?"
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
exit=0
```

**Додатково (за бажанням): матриця колбеків `scripts/send-signed-callback.mjs`** (коміт `828045c`).
21 підписаний колбек — випадок → очікуваний код; підписує так само, як мок і вузол Crypto в n8n.
Секрети бере лише зі змінних (`--env-file=.env.local`) і не друкує ні секрету, ні підписів, ні
ключів, ні тіл. Режими:
- `--listen` — стає «n8n» на :5678 (Header Auth 403, тестовий URL 404, подія без `callbackUrl` →
  200 і чекати далі, запуск → 202 `{job_id}`) і проганяє матрицю на справжньому записі з ключами із
  запиту застосунку;
- `--url` — напряму; випадки, яким потрібен запис, — SKIP без `--request-key` / `--job-id` /
  `--correlation-id`.

Exit 0 / 1 (розбіжність) / 2 (помилка запуску, недоступний роут, ніхто не запустив воркфлоу).

Перевірено на шаблонному роуті зі скіла (`code-templates.md`, без змін) і на справжньому Next.js:

| Перевірка | Результат |
|---|---|
| Прямий режим, запис існує (Node-обгортка навколо коду шаблону) | 21 OK, exit 0, запис → `ready`; 3 прогони поспіль — exit 0 |
| Прямий режим без id | 18 OK, 3 SKIP (`valid`, `replay`, `replay-resigned`), exit 0 |
| `--listen`: неправильний токен / `/webhook-test/` / подія без `callbackUrl` / справжній запуск | 403 / 404 / 200 (чекає далі) / 202 `{job_id}` → 21 OK, exit 0, запис → `ready` |
| `--listen --wait 3` без запуску | exit 2 за 3 с |
| Недоступний роут, немає секрету, немає режиму, невідомий аргумент | exit 2 |
| Витоки у виводі (секрет, токен, `sha256=`, ключі, correlation id, URL документа) | 0 збігів |
| **Справжній Next.js 16** (`next build --webpack`, шаблони клієнта й роуту, `after()` викликає `triggerN8n`), `--listen` | запуск із застосунку → 202 → 21 OK, exit 0; кошторис `q_1` → `ready`; GET → 405 від самого Next; у журналі Next — лише подія, correlation id, код, тривалість, розмір, sha256 |

**Мутаційна перевірка:** 20 навмисно зламаних версій шаблонного роуту, по одному порушенню
контракту в кожній. Скрипт має «вбити» кожну, тобто дати хоча б один FAIL:

| Мутант | Вбили випадки |
|---|---|
| M1 HMAC від `JSON.stringify(JSON.parse(raw))` | `reformatted-body` (202), `malformed-json` (500) |
| M2 немає вікна часу | `stale-`, `future-`, `ms-timestamp` (202) |
| M3 HMAC лише від тіла | `body-only-signature` (202), `valid` (401) і ще 7 |
| M4 ключ не застовплюється | `replay`, `replay-resigned` (202) |
| M5 ключ не звіряється з тілом | `key-not-from-body` (202) |
| M6 ключ не звільняється після 400 | `valid` (200 duplicate, з підказкою «ключ не звільнили») |
| M7 немає ліміту 64 КБ | `too-large` (202) |
| M8 немає перевірки content-type | `text-plain` (202) |
| M9 невідома подія → quote-request | `unknown-event-path` (202) |
| M10 подія тіла не звіряється зі шляхом | `event-mismatch` (202) |
| M11 вікно 600 с | `stale-`, `future-timestamp` (202) |
| M12 мілісекунди приймаються | `ms-timestamp` (202) |
| M13 успіх — 200 замість 202 | `valid` (200, з підказкою «має бути 202») |
| M14 дублікат — 202 `{ok}` | `replay`, `replay-resigned` (202) |
| M15 відсутній ключ «вигадується» з тіла | `no-key` (202) |
| M18 `request.json()` і підпис від `JSON.stringify` | `reformatted-body` (202), `malformed-json` (500) |
| M19 без заголовка підпису — пропустити | `no-signature` (202) |
| M20 без заголовка часу — пропустити | `no-timestamp` (202) |
| M16 `===` замість `timingSafeEqual` | вижив — очікувано: за кодами відповіді не видно; ловить `check-contract.mjs` C10 |
| M17 запис результату в `after()` | вижив — очікувано: за кодами відповіді не видно |

Вбито 18 з 18 мутантів, яких видно за кодами відповіді. Мутаційна перевірка знайшла дві вади в
самому скрипті, обидві виправлено до коміту:
- **`no-timestamp`.** Спершу скрипт підписував тіло з часом і лише потім прибирав заголовок. Такий
  запит роут відхиляв через підпис, тож роут без перевірки часу (M20) проходив. Тепер підпис
  рахується від `.${тіло}`, і цей випадок ловить лише справжня перевірка часу.
- **Підказка для `valid`** при коді 200 тепер розрізняє «duplicate — ключ не звільнили» і «успіх
  має бути 202».

Ще одна вада знайшлася на першому ж прогоні. На Windows `process.exit()` після `fetch` падав на
внутрішній перевірці libuv (`Assertion failed … async.c`), і код виходу ставав 127 замість 0.
Запити переведено на `node:http` без keep-alive.
