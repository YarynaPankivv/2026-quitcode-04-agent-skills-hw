import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteStatusRefresher } from "@/components/quote-status-refresher";
import { getQuote } from "@/lib/data";
import { QUOTE_BUDGET_OPTIONS } from "@/lib/quote-form";
import type { QuoteStatus } from "@/lib/types";

export const metadata: Metadata = {
  title: "Статус кошторису · Studio Nova",
  // The id is the only key to this page: keep it out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const dateTimeFormat = new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short" });

const STATUS_LABELS: Record<QuoteStatus, string> = {
  queued: "Готується",
  ready: "Готовий",
  failed: "Не вдалося",
};

const STATUS_STYLES: Record<QuoteStatus, string> = {
  queued: "bg-sky-50 text-sky-700 ring-sky-200",
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
};

export default async function QuotePage({ params }: PageProps<"/quotes/[id]">) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) notFound();

  const budget = QUOTE_BUDGET_OPTIONS.find((option) => option.value === String(quote.budget ?? ""));

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Studio Nova
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Кошторис для {quote.company}</h1>
            <p className="text-sm text-slate-500">
              Запит від {dateTimeFormat.format(new Date(quote.createdAt))} · бюджет: {budget?.label ?? "—"}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[quote.status]}`}
          >
            {STATUS_LABELS[quote.status]}
          </span>
        </div>

        <section aria-live="polite" className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
          {quote.status === "queued" && (
            <>
              <p className="font-medium">Готуємо кошторис…</p>
              <p className="text-sm text-slate-600">
                Зазвичай це 1–2 хвилини. Можна закрити сторінку й повернутися за цим посиланням пізніше.
              </p>
              <QuoteStatusRefresher />
            </>
          )}

          {quote.status === "ready" && quote.documentUrl && (
            <>
              <p className="font-medium">Кошторис готовий.</p>
              <a
                href={quote.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Завантажити PDF
              </a>
            </>
          )}

          {quote.status === "failed" && (
            <>
              <p className="font-medium">Не вдалося підготувати кошторис.</p>
              <p className="text-sm text-slate-600">Спробуйте надіслати запит ще раз трохи пізніше.</p>
              <Link href="/quotes/new" className="inline-flex text-sm text-indigo-600 hover:text-indigo-800">
                Новий запит на кошторис
              </Link>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
