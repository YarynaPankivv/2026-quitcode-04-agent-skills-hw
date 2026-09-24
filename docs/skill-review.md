# Рев'ю стороннього скіла: `vercel-react-best-practices`

**Дата, інструмент, ОС:** 24.09.2026 · Claude Code 2.1.280 (десктопний застосунок, `claude-opus-5-5`) · Windows 11 Pro + Git Bash, Node v24.15.0

## Що рев'юємо

| | |
|---|---|
| Репозиторій | https://github.com/vercel-labs/agent-skills |
| Тека в репозиторії → `name` | `skills/react-best-practices` → `name: vercel-react-best-practices` |
| Версія | тег `agent-skills-063bee94c3f4df8453406c830b0a7df0f2860278` = коміт `063bee94c3f4df8453406c830b0a7df0f2860278` (28.08.2026, merge PR #328) |
| Навіщо нам | Клієнт скаржиться, що дашборд LeadDesk відкривається понад 2 с. Скіл дає 70 правил продуктивності React/Next.js (водоспади запитів, бандл, серверний кеш, серіалізація), за якими можна зробити рев'ю `app/`, `components/`, `lib/` |

## 1. Подивитись, не встановлюючи

- Як дивились: неглибокий клон тега поза репозиторієм:
  ```bash
  git clone --depth 1 --branch agent-skills-063bee94c3f4df8453406c830b0a7df0f2860278 \
    https://github.com/vercel-labs/agent-skills.git ../review-agent-skills
  ```
  Перевірка клону: `git rev-parse HEAD` → `063bee94c3f4df8453406c830b0a7df0f2860278`, `git status`
  чистий. `npx skills … --list` я не запускала: склад скіла видно з клону тега, а зайвий раз
  виконувати чужий пакет не хотілося. Файли скіла читала як дані й нічого з них не виконувала.
- Склад скіла (`skills/react-best-practices`, 76 файлів, ~418 КБ):

  | Файл / тека | Розмір | Що це |
  |---|---|---|
  | `SKILL.md` | 7 400 Б | Frontmatter, категорії правил за пріоритетом, список id правил, посилання на `rules/*.md` і `AGENTS.md` |
  | `AGENTS.md` | 112 071 Б | Усі правила одним файлом («complete guide with all rules expanded») |
  | `rules/` | 72 файли, 114 589 Б | 70 правил (`async-*`, `bundle-*`, `server-*`, `client-*`, `rerender-*`, `rendering-*`, `js-*`, `advanced-*`) + `_sections.md` і `_template.md` |
  | `README.md` | 3 483 Б | Опис для людей, як додавати правила |
  | `metadata.json` | 936 Б | Версія `1.0.0`, «January 2026», abstract і список посилань. Застарілий: пише «40+ rules», а правил уже 70. CLI його не копіює, тож після встановлення очікую 75 файлів |

- Frontmatter `SKILL.md` (які поля є): `name`, `description`, `license: MIT`,
  `metadata` (`author: vercel`, `version: "1.0.0"`). Полів `allowed-tools`, `hooks`, `context` **немає**.

## 2. Що скіл може виконати, завантажити чи змінити

`S=../review-agent-skills/skills/react-best-practices`, команди з шаблону.

| Перевірка | Результат | Як перевіряли |
|---|---|---|
| `scripts/` та інші виконувані файли (`.sh`, `.mjs`, `.py`…) | Немає. Єдиний файл не `.md` — `metadata.json` (дані). Теки `scripts/` у скілі немає. У корені репозиторію є `scripts/`, `packages/`, `package.json`, але в скіл вони не входять | `find "$S" -type f ! -name "*.md"` |
| `allowed-tools` — попередній дозвіл на інструменти | Немає | frontmatter через `awk`; `grep -c allowed-tools "$S/SKILL.md"` → 0 |
| Команди під час рендеру `` !`cmd` `` | Немає | `grep -rn '!\`' "$S"` → 0 збігів |
| Хуки, MCP-сервери, `plugin.json`, вимога API-ключів | Немає. Жодного `*hooks*.json`, `*mcp*.json`, `plugin.json`, `settings*.json`. Ключів скіл не просить | `find "$S" -name "*hooks*.json" -o -name "*mcp*.json" -o -name "plugin.json" -o -name "settings*.json"` → порожньо |
| Інструкції агенту щось завантажити чи виконати | Лише `npx svgo --precision=1 --multipass icon.svg` (`rules/rendering-svg-precision.md:27` і те саме в `AGENTS.md:2477`). Це приклад для розробника в блоці «Automate with SVGO», а не вказівка агенту. SVG-файлів у LeadDesk немає, тож для нас неактуально. `curl`, `wget`, `WebFetch` немає | `grep -rnE "npx \|curl \|wget \|Invoke-WebRequest\|WebFetch" "$S"` |
| Посилання: куди ведуть, чи є «прочитай інструкції звідси» | 35 унікальних URL: react.dev, nextjs.org, vercel.com (блог і доки), swr.vercel.app, github.com (`isaacs/node-lru-cache`, `shuding/better-all`), MDN, webpack, vite, esbuild, csstriggers, gist Пола Айріша, jsfiddle, а також `example.com` у прикладах коду. Усі — довідкові посилання «Reference: …». Жодне не каже агенту «завантаж і виконай правила звідти» | `grep -rhoE "https?://…" "$S" \| sort \| uniq -c`; `grep -rniE "(read\|load\|fetch\|download\|follow).{0,40}(instructions\|rules) (from\|at)"` → 0 |
| Приховані інструкції: HTML-коментарі, «ignore previous…», невидимі символи, base64 | Нічого: 0 збігів на `ignore previous`, `system prompt`, `<!--`; `0 file(s) with zero-width characters`; довгих base64-рядків (60+ символів) немає | `grep -rniE …`, `node -e …` з шаблону, `grep -rnoE "[A-Za-z0-9+/]{60,}={0,2}"` |

Висновок п. 2: скіл складається лише з markdown-тексту. Сам він нічого не виконує, не завантажує і
не просить дозволів. Ризик тільки в тому, що агент застосує пораду, яка не підходить нашій версії
Next.js. Це перевірю в п. 5.

## 3. Аудити

| Аудит | Результат | Дата аналізу |
|---|---|---|
| Gen (Agent Trust Hub) | **Pass**, Risk Level: SAFE. Окремо позначено `INDIRECT_PROMPT_INJECTION`: скіл обробляє код користувача, тож теоретично через цей код можна підкинути інструкції. Для нас це нормальний ризик, бо код наш | 14.09.2026 |
| Socket | **Pass**: malicious behavior, security concerns, obfuscation, suspicious patterns — без зауважень | 14.09.2026, 22:49 |
| Snyk | **Pass**, Risk Level: LOW, «No issues detected» | 14.09.2026, 22:48 |

- Де взяли: skills.sh, сторінка https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices,
  блок «Security audits» і сторінки кожного аудиту (`…/security/agent-trust-hub`, `…/socket`, `…/snyk`).
  Там же: 740.3K встановлень, 31.5K зірок, first seen 19.01.2026.
- Чому CLI показав або не показав блок: CLI для перегляду я не запускала, тому аудити брала зі
  skills.sh. Встановлювати планую з `DISABLE_TELEMETRY=1`, а з цією змінною CLI аудити не завантажує
  і блоку «Security Risk Assessments» не покаже.
- До чого прив'язаний аудит: до «репозиторій + назва скіла», **не до нашого тега**. На skills.sh
  немає ні тега, ні SHA коміту. Аудити датовано 14.09.2026, тобто вони новіші за наш тег (28.08.2026).
  У Socket вказано лише хеш вмісту (`@ca7b0c0c…2506212`), і не видно, якому коміту він відповідає.
  Тому аудит для мене — додатковий сигнал, а основне — моя власна перевірка з п. 2.

## 4. Ліцензія й походження

- Ліцензія: MIT. Заявлена у frontmatter `SKILL.md` (`license: MIT`) і в розділі «License» кореневого
  `README.md`. Окремого файлу `LICENSE` у репозиторії немає, тому GitHub API показує `"license": null`.
  Для навчального проєкту заяви у frontmatter і README мені досить. Для клієнтського проєкту я б
  попросила Vercel додати файл `LICENSE`.
- Видавець і активність: організація GitHub `vercel-labs` (офіційна «лабораторна» організація
  Vercel), опис репозиторію «Vercel's official collection of agent skills». Репозиторій створено
  08.12.2025, останній push 28.08.2026 (це і є наш тег), 31.5K зірок, 2.7K форків, 173 відкриті
  issues, не архівований. На skills.sh — 740.3K встановлень. Автор тега: Aurora Scharff (merge PR #328).

## 5. Чи правдивий зміст для нашого стеку

_Допишу після кроку 5 (рев'ю застосунку й виправлення): звірю поради, які застосую, з
`node_modules/next/dist/docs/` (Next.js 16.3.5)._

| Порада скіла (id) | Що каже скіл | Що каже документація нашої версії | Висновок |
|---|---|---|---|
| | | | |

## 6. Закріплення версії й коміт

- Команда встановлення (запускала сама в Git Bash; scope → Project, «Proceed with installation?» → Yes):
  ```bash
  DISABLE_TELEMETRY=1 npx skills@1.7.0 add vercel-labs/agent-skills#agent-skills-063bee94c3f4df8453406c830b0a7df0f2860278 \
    --skill vercel-react-best-practices -a claude-code --copy
  ```
- Де лягли файли; справжні файли чи посилання: `.claude/skills/vercel-react-best-practices/`, 75 справжніх
  файлів (у git усі з режимом `100644`, жодного symlink чи junction). Теки `.agents/` немає, глобальної
  копії в `~/.claude/skills/` теж. `diff -r` з клоном тега з п. 1 відрізняється лише `metadata.json`,
  який CLI не копіює, тож встановлено саме те, що я рев'ювала.
- Що потрапило в git: коміт `b5ef777` «skills: vendor vercel-react-best-practices pinned to
  agent-skills-063bee9», 76 файлів: тека скіла + `skills-lock.json` (`source: vercel-labs/agent-skills`,
  `ref: agent-skills-063bee94…`, `computedHash: 6b526d01…`).
- Як оновлювати: не «наосліп». Беру новий тег, клоную його поза репозиторієм, дивлюся `diff -r` зі
  встановленою текою і проходжу цей чекліст для змін. Якщо все гаразд — та сама команда `add` з новим
  тегом і `--copy`, перевірка (кількість файлів, немає `.agents/`) і окремий коміт. `npx skills@1.7.0
  experimental_install` для відновлення не використовую: він пише лише в `.agents/skills/`, яку
  Claude Code не читає, тому справжні файли тримаємо в git.

## Вердикт

**Встановити з умовами.** Ризик низький: скіл складається лише з markdown від офіційної організації
Vercel, без скриптів, `allowed-tools`, хуків, команд рендеру й прихованих інструкцій. Три аудити
skills.sh — Pass. Умови:
- встановлювати з закріпленим тегом і `--copy`, щоб у git лягли справжні файли разом із `skills-lock.json`;
- оновлювати лише через повторне рев'ю diff за цим чеклістом;
- кожну пораду перед застосуванням звіряти з документацією Next.js 16.3.5;
- аудити skills.sh не прив'язані до нашого тега, тож вважаю їх лише додатковим сигналом.
