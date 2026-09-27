export const QUOTE_BUDGET_OPTIONS = [
  { value: "", label: "Ще не визначились" },
  { value: "1000", label: "до $1000" },
  { value: "3000", label: "$1000–3000" },
  { value: "10000", label: "$3000–10 000" },
  { value: "25000", label: "понад $10 000" },
] as const;

export const QUOTE_DESCRIPTION_MAX_LENGTH = 2000;

export type QuoteField = "company" | "email" | "description" | "budget";

export type QuoteFormData = {
  company: string;
  email: string;
  description: string;
  budget: number | null;
};

export type QuoteFormState =
  | { status: "idle" }
  | {
      status: "invalid";
      errors: Partial<Record<QuoteField, string>>;
      values: Partial<Record<QuoteField, string>>;
    }
  | { status: "error"; message: string; values?: Partial<Record<QuoteField, string>> }
  | { status: "queued"; id: string };

export type ParseQuoteResult =
  | { ok: true; data: QuoteFormData }
  | {
      ok: false;
      errors: Partial<Record<QuoteField, string>>;
      values: Partial<Record<QuoteField, string>>;
    };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(formData: FormData, name: QuoteField) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function parseQuoteForm(formData: FormData): ParseQuoteResult {
  const values = {
    company: text(formData, "company").slice(0, 120),
    email: text(formData, "email").slice(0, 200).toLowerCase(),
    description: text(formData, "description"),
    budget: text(formData, "budget").slice(0, 10),
  };

  const errors: Partial<Record<QuoteField, string>> = {};
  if (!values.company) errors.company = "Вкажіть назву компанії";
  if (!EMAIL_RE.test(values.email)) errors.email = "Перевірте email";
  if (values.description.length < 20) {
    errors.description = "Опишіть задачу докладніше: хоча б пару речень";
  } else if (values.description.length > QUOTE_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Опис задовгий: ${values.description.length} із ${QUOTE_DESCRIPTION_MAX_LENGTH} символів`;
  }
  if (!QUOTE_BUDGET_OPTIONS.some((option) => option.value === values.budget)) {
    errors.budget = "Оберіть бюджет зі списку";
  }

  if (Object.keys(errors).length > 0) {
    // Echo back what the person typed (capped) so the fields are not wiped.
    return {
      ok: false,
      errors,
      values: { ...values, description: values.description.slice(0, QUOTE_DESCRIPTION_MAX_LENGTH * 2) },
    };
  }

  return {
    ok: true,
    data: {
      company: values.company,
      email: values.email,
      description: values.description,
      budget: values.budget ? Number(values.budget) : null,
    },
  };
}
