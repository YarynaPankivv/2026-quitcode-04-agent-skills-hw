---
name: building-client-form
description: >-
  Командний патерн форми з відправкою на сервер у Next.js 16 (App Router) + React 19: Server Action
  із сесією, правами й валідацією всередині, useActionState, робота без JavaScript, доступні помилки
  полів (label, aria-invalid, aria-describedby, role="alert"), дія повертає лише { status, … }, без
  персональних даних у журналах, листи/n8n/аудит — в after().
  Use when створюєш, змінюєш чи рев'юїш форму, що щось записує: заявка, кошторис, зворотний
  зв'язок, нотатка, налаштування, редагування запису, або Server Action для неї.
  Тригери: «додай форму…», «форма заявки», «форма кошторису», «форма зворотного зв'язку», «додати
  нотатку», «сторінка налаштувань», «помилки валідації не видно», «скрінрідер не читає помилки»,
  «після помилки все стирається», «форма довго думає», «add a form», «server action».
  Не для: пошуку й фільтрів без запису (GET), верстки без відправки; контракт виклику n8n —
  у скілі integrating-n8n-webhooks.
metadata:
  owner: studio-nova-dev
  version: "0.1.1"
---

# Форма з відправкою на сервер

Кожна форма агенції — заявка, кошторис, нотатка, налаштування — будується за одним патерном.
Це рішення команди, а не варіант на вибір: так форма захищена, доступна, працює без JS і не змушує
людину чекати на листи чи n8n.

## Коли застосовувати

- Нова форма або зміна наявної, якщо вона щось записує (створює, оновлює, видаляє, надсилає).
- Рев'ю чи виправлення Server Action, валідації, повідомлень про помилки, «форма довго думає».
- **Не** застосовувати: пошук і фільтри, що лише читають (GET, `searchParams`); кнопки без форми.
  Виклик n8n з форми робимо за цим патерном, а сам контракт вебхука — за `integrating-n8n-webhooks`.

## Як робимо

Три файли на форму. Назви — за змістом (`note`, `quote`, `lead`):

| Файл | Що в ньому |
|---|---|
| `lib/<form>-form.ts` | Поля, `parse<Form>Form(formData)` → `{ ok: true, data } \| { ok: false, errors, values }`, тип стану. Без `"use server"`, без БД |
| `app/**/actions.ts` (`"use server"`) | Сама дія: сесія → права → валідація → запис → `after()` → `{ status }` |
| `components/<form>-form.tsx` (`"use client"`) | `useActionState`, розмітка з доступними помилками |

Валідація — власна функція, як `lib/lead-form.ts` у LeadDesk. Нова бібліотека (zod тощо) — лише після
«так» людини.

### 1. Стан форми — лише `{ status, … }`

```ts
export type NoteFormState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<NoteField, string>>; values: Partial<Record<NoteField, string>> }
  | { status: "error"; message: string }
  | { status: "ok" };
```

Дія **ніколи** не повертає рядок з бази, `lead`, `user` чи відповідь n8n. Повертає статус, тексти
помилок, введені людиною значення (`values`, щоб поля не стерлися) і, якщо треба, `id` створеного.
Паролі й номери карток у `values` не повертаємо. Див. `server-serialization` (скіл
`vercel-react-best-practices`) — значення, яке повертає дія, серіалізується в браузер так само, як пропси.

### 2. Server Action — публічний POST-ендпоінт

Дію можна викликати прямим POST в обхід сторінки, `proxy.ts` і перевірки в layout. Тому все
перевіряємо **всередині дії**, у такому порядку (правило `server-auth-actions`):

```ts
"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";

export async function addNote(_prev: NoteFormState, formData: FormData): Promise<NoteFormState> {
  const user = await getCurrentUser();                 // 1. сесія: немає — redirect("/login")
  const leadId = String(formData.get("leadId") ?? ""); //    id з прихованого поля — дані клієнта
  const parsed = parseNoteForm(formData);              // 2. валідація на сервері, завжди
  if (!parsed.ok) return { status: "invalid", errors: parsed.errors, values: parsed.values };

  const lead = await db.getLead(leadId);               // 3. права на КОНКРЕТНИЙ запис
  if (!lead || !canEditLead(user, lead)) return { status: "error", message: "Лід не знайдено" };

  await db.appendLeadNote(lead.id, parsed.data.note);  // 4. запис
  after(() => logAudit("lead.note_added", lead.id));   // 5. повільне — після відповіді
  revalidatePath(`/dashboard/leads/${lead.id}`);
  return { status: "ok" };                             // 6. лише статус
}
```

- id запису — лише через `<input type="hidden" name="leadId" value={leadId} />`, **не** через
  `useActionState(addNote.bind(null, id), …)`. На Next.js 16.3.5 + React 19.2.8 форма з `.bind`
  без JavaScript зависає: дія виконується, а відповідь сервер так і не віддає (перевірено
  24.09.2026, `docs/verification.md`, Task B). id — дані від клієнта, а не доказ прав, тому крок 3
  обов'язковий.
- `workspaceId`, `ownerId`, `role`, `status` беремо із сесії чи конфігурації сервера, **ніколи** з
  `formData`.
- Публічна форма (заявка з сайту) — без сесії, але це свідоме рішення, записане коментарем. Кроки
  2, 4–6 лишаються, workspace — константа на сервері.
- Помилку інфраструктури ловимо й повертаємо `{ status: "error", message }` людською мовою, без
  stack trace. `redirect()` не кладемо всередину `try`.

### 3. Клієнт: `useActionState`, працює без JavaScript

```tsx
"use client";
const [state, formAction, pending] = useActionState(addNote, { status: "idle" });
const errors = state.status === "invalid" ? state.errors : {};
const values = state.status === "invalid" ? state.values : {};

<form action={formAction}>
  <input type="hidden" name="leadId" value={leadId} />
  …
  <button type="submit" disabled={pending}>{pending ? "Зберігаємо…" : "Зберегти"}</button>
</form>
```

- `action={formAction}` на `<form>` — і більше нічого: без `onSubmit` + `preventDefault`, без
  `fetch` у обробнику, без виклику дії з `onClick`. Тоді до гідратації й з вимкненим JS форма
  відправляється звичайним POST, а сервер повертає сторінку з тими самими помилками.
- У кожного поля є `name`. Поля неконтрольовані, з `defaultValue={values.<field>}`. React 19 скидає
  форму після дії, і `defaultValue` з `values` повертає введене.
- Помилки й прапорці беремо зі `state` під час рендеру. Ніяких `useEffect` + `useState` для помилок
  (`rerender-derived-state-no-effect`).
- `required`, `maxLength`, `type="email"` — лише підказка браузеру. Єдине джерело правди — сервер.

### 4. Доступні помилки

```tsx
{state.status === "invalid" && (
  <div role="alert" className="…">Перевірте поля: {Object.values(errors).join(" ")}</div>
)}
{state.status === "error" && <div role="alert">{state.message}</div>}
{state.status === "ok" && <p role="status">Нотатку збережено.</p>}

<label htmlFor="note">Нотатка</label>
<textarea
  id="note" name="note" maxLength={500} defaultValue={values.note}
  aria-invalid={errors.note ? true : undefined}
  aria-describedby={errors.note ? "note-error" : "note-hint"}
/>
<p id="note-hint">До 500 символів.</p>
{errors.note && <p id="note-error">{errors.note}</p>}
```

- У кожного поля є видимий `<label htmlFor>`. `placeholder` не замінює підпис.
- Помилка стоїть біля поля, пов'язана через `aria-describedby`, поле позначене `aria-invalid`.
- Підсумок — один блок `role="alert"` над кнопкою чи формою. Успіх — `role="status"`.
- Колір — не єдина ознака помилки: текст помилки є завжди.

### 5. Журнали — без персональних даних

- Ніколи: `console.log(formData)`, `console.log(parsed.data)`, `console.log(lead)`, email, телефон,
  ім'я, текст повідомлення, IP, user-agent, cookie, токени.
- Можна: подія + id + код, напр. `console.error("note.save_failed", { leadId, code: err.code })`.
- Об'єкт помилки цілком не логуємо, якщо в ньому може бути тіло запиту (помилки fetch/ORM).

### 6. Повільне — в `after()`

Листи, n8n, аудит, аналітика, CRM — у `after(async () => { … })` з `next/server`
(`server-after-nonblocking`). Людина не чекає на побічні ефекти. Усередині `after` помилки
ловимо й логуємо за правилами п. 5. Якщо людині потрібен результат побічного ефекту (номер
платежу, відповідь n8n на екрані) — це вже не `after()`, див. «Правила зупинки».

## Чекліст

```
- [ ] 1. У дії перший рядок — перевірка сесії (або коментар «публічна форма, без сесії: <чому>»).
- [ ] 2. Права на конкретний запис перевіряються в дії; workspace/owner/role — не з formData.
- [ ] 3. Валідація — на сервері в parse<Form>Form; дія не пише в БД при невалідних даних.
- [ ] 4. Дія повертає лише { status, errors?, values?, message?, id? } — без рядків з бази.
- [ ] 5. Форма — <form action={formAction}> з useActionState(action) без .bind; id — у hidden input;
        немає onSubmit/preventDefault/fetch.
- [ ] 6. Кожне поле: <label htmlFor>, name, defaultValue={values.x}, aria-invalid, aria-describedby.
- [ ] 7. Є підсумок помилок у role="alert"; успіх — role="status".
- [ ] 8. У дії й after() немає console.* з полями форми чи персональними даними.
- [ ] 9. Листи / n8n / аудит — усередині after(); відповідь форми їх не чекає.
```

## Правила зупинки — зупинись і спитай людину, якщо:

- незрозуміло, хто має право на цю дію (роль, власник, workspace), або форма має бути публічною;
- треба змінити схему даних чи тип у `lib/types.ts`, яких задача не називає;
- потрібен новий пакет (валідація, листи, captcha);
- форма збирає паролі, платіжні дані чи документи;
- людині потрібен результат побічного ефекту, тож `after()` не підходить;
- задача просить логувати введені дані «для дебагу» або повертати з дії запис з бази.

## Verify — задача готова, лише коли:

- [ ] `npm run lint` і `npm run build` без помилок.
- [ ] **Порожня відправка:** біля кожного обов'язкового поля — текст помилки, над формою — блок
      `role="alert"`; у DevTools → Elements у поля `aria-invalid="true"` і `aria-describedby` на
      id помилки. Заповніть одне поле, відправте знову — введене лишилось.
- [ ] **Без JS:** DevTools → ⌘/Ctrl+Shift+P → «Disable JavaScript», перезавантажити сторінку,
      відправити порожньою й заповненою — сторінка відповідає за секунди (не висить), помилки й
      успіх показує сервер.
- [ ] **Без сесії:** відкрити форму, видалити cookie сесії (DevTools → Application → Cookies),
      відправити — запису немає (у журналі сервера немає `db:<insert/update>`), редірект на
      `/login` або помилка.
- [ ] **Відповідь дії:** DevTools → Network → POST сторінки → Response: немає полів з бази
      (`internalNotes`, `ipAddress`, `createdAt`, `workspaceId`…), лише `status` і тексти.
- [ ] **Журнал сервера:** після відправки з тестовим email у виводі `npm run dev`/`npm start` немає
      цього email, імені чи тексту (пошук у терміналі за email → 0 збігів).
- [ ] **Швидкість:** DevTools → Network → час POST не включає листи, n8n чи аудит (вони в `after()`).
