# Інтеграції з n8n

Контракт — скіл `.claude/skills/integrating-n8n-webhooks`. Одна подія — один рядок.

| event | напрям | шлях n8n | режим | код | власник |
|---|---|---|---|---|---|
| `quote-request` | Next.js → n8n → колбек | `/webhook/quote-request` | Respond to Webhook 202 + колбек `POST /api/n8n/quote-request` | `app/quotes/new/actions.ts`, `app/api/n8n/[event]/route.ts` | _уточнити_ |
| `lead-created` | Next.js → n8n | `/webhook/lead-created` | Immediately | `app/actions.ts` — **ще не за контрактом** (прямий `fetch`, увесь запис ліда, без токена) | _уточнити_ |

## quote-request

- Запуск: `{ version: 1, event: "quote-request", data: { quoteId, company, description, budget }, callbackUrl }`.
  Email клієнта в n8n не йде — кошторис показуємо на `/quotes/[id]`.
- Колбек: `event` = `quote-request.completed` (`data.result.documentUrl` — http(s)-посилання на PDF)
  або `quote-request.failed` (`data.error.code`); запис шукаємо за `data.requestIdempotencyKey`.
- Воркфлоу триває 40–90 с; сторінка статусу опитує сервер кожні 5 с і показує
  `Готується` → `Готовий` / `Не вдалося`.
- Ключі ідемпотентності колбеків зараз у пам'яті процесу (`lib/db.ts`) — лише для демо.
