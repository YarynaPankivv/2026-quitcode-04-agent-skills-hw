"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestQuote } from "@/app/quotes/new/actions";
import {
  QUOTE_BUDGET_OPTIONS,
  QUOTE_DESCRIPTION_MAX_LENGTH,
  type QuoteField,
  type QuoteFormState,
} from "@/lib/quote-form";

const initialState: QuoteFormState = { status: "idle" };

const inputClass =
  "mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 aria-[invalid=true]:border-red-500";

export function QuoteForm() {
  const [state, formAction, pending] = useActionState(requestQuote, initialState);
  const router = useRouter();
  const errors = state.status === "invalid" ? state.errors : {};
  const values = state.status === "invalid" ? state.values : {};

  useEffect(() => {
    if (state.status === "queued") router.push(`/quotes/${state.id}`);
  }, [state, router]);

  if (state.status === "queued") {
    return (
      <div role="status" className="space-y-2 py-8 text-center">
        <p className="text-lg font-medium">Запит прийнято.</p>
        <Link href={`/quotes/${state.id}`} className="text-sm text-indigo-600 hover:text-indigo-800">
          Переходимо до статусу кошторису…
        </Link>
      </div>
    );
  }

  const fieldProps = (name: QuoteField) => ({
    id: name,
    name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const fieldError = (name: QuoteField) =>
    errors[name] && (
      <p id={`${name}-error`} className="mt-1 text-xs text-red-600">
        {errors[name]}
      </p>
    );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="company" className="block text-sm font-medium">
            Компанія
          </label>
          <input {...fieldProps("company")} autoComplete="organization" defaultValue={values.company} className={inputClass} />
          {fieldError("company")}
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input {...fieldProps("email")} type="email" autoComplete="email" defaultValue={values.email} className={inputClass} />
          {fieldError("email")}
        </div>
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium">
          Опис задачі
        </label>
        <textarea
          {...fieldProps("description")}
          rows={6}
          maxLength={QUOTE_DESCRIPTION_MAX_LENGTH}
          defaultValue={values.description}
          placeholder="Що треба зробити, які терміни, що вже є"
          className={inputClass}
        />
        {fieldError("description")}
      </div>

      <div>
        <label htmlFor="budget" className="block text-sm font-medium">
          Бюджет
        </label>
        <select {...fieldProps("budget")} defaultValue={values.budget ?? ""} className={inputClass}>
          {QUOTE_BUDGET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {fieldError("budget")}
      </div>

      {state.status === "error" && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Надсилаємо…" : "Отримати кошторис"}
      </button>
    </form>
  );
}
