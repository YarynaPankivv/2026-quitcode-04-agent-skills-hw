"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getCurrentUser, getWorkspace } from "@/lib/data";
import { parseNoteForm, type NoteFormState } from "@/lib/note-form";

export async function addLeadNote(
  _prevState: NoteFormState,
  formData: FormData,
): Promise<NoteFormState> {
  // 1. Session: no valid session -> redirect("/login") inside getCurrentUser.
  const user = await getCurrentUser();
  // leadId comes from a hidden field: client data, not proof of access (checked in step 3).
  const leadId = String(formData.get("leadId") ?? "");

  // 2. Server-side validation, always.
  const parsed = parseNoteForm(formData);
  if (!parsed.ok) {
    return { status: "invalid", errors: parsed.errors, values: parsed.values };
  }

  try {
    // 3. Access to this specific lead: same rule as the lead page —
    //    the lead must belong to the signed-in user's workspace.
    const [workspace, lead] = await Promise.all([
      getWorkspace(user.workspaceSlug),
      db.getLead(leadId),
    ]);
    if (!lead || lead.workspaceId !== workspace.id) {
      return { status: "error", message: "Лід не знайдено.", values: { note: parsed.data.note } };
    }

    // 4. Write.
    const saved = await db.appendLeadNote(lead.id, parsed.data.note);
    if (!saved) {
      return { status: "error", message: "Лід не знайдено.", values: { note: parsed.data.note } };
    }
  } catch (error) {
    const code = error instanceof Error ? error.name : "unknown";
    console.error("lead.note_save_failed", { leadId, code });
    // Keep what the person typed: React resets the uncontrolled field after the action.
    return { status: "error", message: "Не вдалося зберегти нотатку. Спробуйте ще раз.", values: { note: parsed.data.note } };
  }

  // 5. Slow side effects after the response.
  after(async () => {
    try {
      await logAudit("lead.note_added", leadId);
    } catch (error) {
      const code = error instanceof Error ? error.name : "unknown";
      console.error("lead.note_audit_failed", { leadId, code });
    }
  });

  revalidatePath(`/dashboard/leads/${leadId}`);

  // 6. Status only — no lead data goes back to the browser.
  return { status: "ok" };
}
