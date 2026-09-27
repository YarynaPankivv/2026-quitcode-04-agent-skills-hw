"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { db } from "@/lib/db";
import { takeRateLimit } from "@/lib/rate-limit";
import { n8nCallbackUrl, triggerN8n } from "@/lib/n8n/client";
import { parseQuoteForm, type QuoteFormState } from "@/lib/quote-form";
import type { Quote } from "@/lib/types";

export async function requestQuote(
  _prevState: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  // 1. Public form, like the lead form on "/": deliberately no session.
  // 2. Server-side validation, always.
  const parsed = parseQuoteForm(formData);
  if (!parsed.ok) {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }

  // Every request starts a 40–90 s PDF workflow in the client's n8n: at most 5 per 10 min per IP.
  // x-forwarded-for is only trustworthy behind a proxy that overwrites it.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!takeRateLimit(`quote:${ip}`, 5, 10 * 60 * 1000)) {
    const { company, email, description, budget } = parsed.data;
    return {
      status: "error",
      message: "Забагато запитів поспіль. Спробуйте за кілька хвилин.",
      values: { company, email, description, budget: budget === null ? "" : String(budget) },
    };
  }

  // 3. Save before n8n hears about it: status "queued", keys stored with the quote
  //    so retries reuse them and the callback can find this quote.
  let quote: Quote;
  try {
    quote = await db.insertQuote({
      ...parsed.data,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
    });
  } catch (error) {
    const code = error instanceof Error ? error.name : "unknown";
    console.error("quote.save_failed", { code });
    return { status: "error", message: "Не вдалося надіслати запит. Спробуйте ще раз." };
  }

  // 4. The workflow runs 40–90 s: start it after the response and let /quotes/[id]
  //    show the status. n8n answers 202 at once and posts the result to the callback.
  const { id, company, description, budget, idempotencyKey, correlationId } = quote;
  after(async () => {
    let failureCode: string | null = null;
    try {
      const result = await triggerN8n(
        "quote-request",
        { quoteId: id, company, description, budget }, // what the workflow needs, no email
        { idempotencyKey, correlationId, callbackUrl: n8nCallbackUrl("quote-request") },
      );
      if (!result.ok) failureCode = `n8n_${result.status ?? result.reason}`;
    } catch (error) {
      // A missing N8N_* / APP_BASE_URL: the message names the variable, never its value.
      failureCode = "n8n_config";
      console.error("quote.trigger_failed", { correlationId, reason: error instanceof Error ? error.message : "unknown" });
    }
    if (failureCode) {
      console.error("quote.not_accepted_by_n8n", { quoteId: id, correlationId, failureCode });
      await db.markQuoteFailed(id, failureCode);
    }
  });

  // 5. Status and id only — nothing else from the record goes back to the browser.
  return { status: "queued", id };
}
