export const NOTE_MAX_LENGTH = 500;

export type NoteField = "note";

export type NoteFormData = {
  note: string;
};

export type NoteFormState =
  | { status: "idle" }
  | {
      status: "invalid";
      errors: Partial<Record<NoteField, string>>;
      values: Partial<Record<NoteField, string>>;
    }
  | { status: "error"; message: string; values?: Partial<Record<NoteField, string>> }
  | { status: "ok" };

export type ParseNoteResult =
  | { ok: true; data: NoteFormData }
  | {
      ok: false;
      errors: Partial<Record<NoteField, string>>;
      values: Partial<Record<NoteField, string>>;
    };

export function parseNoteForm(formData: FormData): ParseNoteResult {
  const raw = formData.get("note");
  const note = typeof raw === "string" ? raw.trim() : "";

  const errors: Partial<Record<NoteField, string>> = {};
  if (!note) {
    errors.note = "Напишіть текст нотатки";
  } else if (note.length > NOTE_MAX_LENGTH) {
    errors.note = `Нотатка задовга: ${note.length} із ${NOTE_MAX_LENGTH} символів`;
  }

  if (Object.keys(errors).length > 0) {
    // Echo back what the person typed (capped) so the field is not wiped.
    return { ok: false, errors, values: { note: note.slice(0, NOTE_MAX_LENGTH * 2) } };
  }

  return { ok: true, data: { note } };
}
