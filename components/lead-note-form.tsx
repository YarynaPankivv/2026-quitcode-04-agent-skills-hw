"use client";

import { useActionState } from "react";
import { addLeadNote } from "@/app/dashboard/leads/[id]/actions";
import { NOTE_MAX_LENGTH, type NoteFormState } from "@/lib/note-form";

const initialState: NoteFormState = { status: "idle" };

export function LeadNoteForm({ leadId }: { leadId: string }) {
  const [state, formAction, pending] = useActionState(addLeadNote, initialState);
  const errors = state.status === "invalid" ? state.errors : {};
  const values = state.status === "invalid" ? state.values : {};

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm"
    >
      <h2 className="font-medium">Додати нотатку</h2>
      <input type="hidden" name="leadId" value={leadId} />

      <div>
        <label htmlFor="note" className="block font-medium">
          Нотатка
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          maxLength={NOTE_MAX_LENGTH}
          defaultValue={values.note}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={errors.note ? "note-error note-hint" : "note-hint"}
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 aria-[invalid=true]:border-red-500"
        />
        <p id="note-hint" className="mt-1 text-xs text-slate-500">
          До {NOTE_MAX_LENGTH} символів. Нотатку бачить лише команда.
        </p>
        {errors.note && (
          <p id="note-error" className="mt-1 text-xs text-red-600">
            {errors.note}
          </p>
        )}
      </div>

      {state.status === "invalid" && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          Перевірте поля: {Object.values(errors).join(" ")}
        </div>
      )}
      {state.status === "error" && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          {state.message}
        </div>
      )}
      {state.status === "ok" && (
        <p role="status" className="text-green-700">
          Нотатку збережено.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {pending ? "Зберігаємо…" : "Зберегти нотатку"}
      </button>
    </form>
  );
}
