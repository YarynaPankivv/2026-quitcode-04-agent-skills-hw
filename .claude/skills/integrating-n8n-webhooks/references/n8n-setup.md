# Що налаштувати на боці n8n

Воркфлоу клієнта — його власність: ми не будуємо й не змінюємо його самі, не експортуємо й не
імпортуємо JSON. Агент готує **текст** для людини, яка має доступ до n8n, — цей список, заповнений
під конкретну подію, — і додає рядок у реєстр інтеграцій.

## Асинхронна подія (стандарт): `<event>` → 202 → колбек

| # | Вузол | Налаштування |
|---|---|---|
| 1 | **Webhook** | Method `POST`; Path `<event>` (kebab-case); Authentication **Header Auth**, credential: Name `x-n8n-token`, Value = `N8N_WEBHOOK_TOKEN`; Respond: **Using 'Respond to Webhook' Node**. Фіксовані IP хостингу — Options → IP(s) Allowlist (за reverse proxy — `N8N_PROXY_HOPS`). Дані далі — `$json.body`, заголовки — `$json.headers` (нижній регістр) |
| 2 | **Remove Duplicates** | «Remove Items Processed in Previous Executions», значення `{{ $json.headers['idempotency-key'] }}` |
| 3 | **Respond to Webhook** | Respond With JSON, Response Code `202`, тіло `{"job_id": "{{ $execution.id }}"}` |
| 4 | … робота воркфлоу … | PDF, розрахунок, CRM — на боці клієнта |
| 5 | **Edit Fields** | `ts` = `{{ Math.floor($now.toSeconds()) }}`; `body` = `{{ JSON.stringify({ version: 1, event: '<event>.completed', data: { jobId: $execution.id, status: 'completed', correlationId: $('Webhook').item.json.headers['x-correlation-id'], requestIdempotencyKey: $('Webhook').item.json.headers['idempotency-key'], result: { documentUrl: … }, completedAt: $now.toISO() } }) }}` |
| 6 | **Crypto** (v2) | Action `Hmac`, Type `SHA256`, Encoding `HEX`, Value `{{ $json.ts + '.' + $json.body }}`, credential **Crypto**: Hmac Secret = `N8N_CALLBACK_SECRET` |
| 7 | **HTTP Request** | `POST` на `{{ $('Webhook').item.json.body.callbackUrl }}`. Headers: `x-n8n-timestamp` = `ts`, `x-n8n-signature` = `sha256=` + результат Crypto, `idempotency-key` = `{{ $execution.id }}:<event>.completed` (ті самі `jobId` і `event`, що в тілі), `x-correlation-id` — із вхідних заголовків. Body Content Type **Raw**, Content Type `application/json`, Body = поле `body`. Options → Timeout `10000`. Settings → Retry On Fail, Max Tries `3`, Wait Between Tries `1000` |
| 8 | **Save → Publish** | Після кожної зміни — Publish знову (n8n 2.x виконує опубліковану версію) |

Ключові моменти, які людина має підтвердити:

- тіло підписується й відправляється **одним і тим самим рядком** (Raw), а не «JSON → Using
  Fields Below»: n8n не гарантує ті самі байти після серіалізації полів;
- n8n у Docker, застосунок на хості — `callbackUrl` через `host.docker.internal`, не `localhost`
  (тоді й `APP_BASE_URL` відповідний);
- гілка помилки воркфлоу надсилає той самий колбек з `event: '<event>.failed'`,
  `data.status: 'failed'`, `data.error: { code }`.

## Подія «до відома»: `<event>` → 200

Лише кроки 1 (Respond: **Immediately**) і 2. Колбека немає, `callbackUrl` не передаємо.

## Реєстр інтеграцій проєкту

Кожна подія — рядок у `docs/n8n-integrations.md` проєкту (створи файл, якщо його немає):

| event | напрям | шлях n8n | режим | власник |
|---|---|---|---|---|
| `quote-request` | Next.js → n8n → колбек | `/webhook/quote-request` | Respond to Webhook 202 + колбек | ім'я відповідального (спитай людину) |
| `lead-created` | Next.js → n8n | `/webhook/lead-created` | Immediately | … |

Сюди ж — нестандартні шляхи `N8N_ENDPOINT_WEBHOOK` на self-hosted клієнта, якщо вони є.
