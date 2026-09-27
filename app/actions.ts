"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser, getWorkspace } from "@/lib/data";
import { triggerN8n } from "@/lib/n8n/client";
import { logAudit } from "@/lib/audit";
import { parseLeadForm, type LeadFormField } from "@/lib/lead-form";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/types";

const PUBLIC_FORM_WORKSPACE_ID = "ws_studio_nova";

export type SubmitLeadState =
  | { status: "idle" }
  | { status: "invalid"; errors: Partial<Record<LeadFormField, string>> }
  | { status: "ok" };

export async function submitLead(
  _prevState: SubmitLeadState,
  formData: FormData,
): Promise<SubmitLeadState> {
  const parsed = parseLeadForm(formData);
  if (!parsed.ok) {
    return { status: "invalid", errors: parsed.errors };
  }

  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get("x-forwarded-for")?.split(",")[0].trim() ?? "127.0.0.1";
  const userAgent = requestHeaders.get("user-agent") ?? "";

  const lead = await db.insertLead({
    ...parsed.data,
    workspaceId: PUBLIC_FORM_WORKSPACE_ID,
    jobTitle: "",
    city: "",
    country: "",
    source: "website",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    ipAddress,
    userAgent,
    rawPayload: {
      form: { id: "contact-main", version: "2026-07", fields: parsed.data },
      request: {
        ip: ipAddress,
        userAgent,
        acceptLanguage: requestHeaders.get("accept-language"),
        receivedAt: new Date().toISOString(),
      },
    },
    // One key per lead, stored with it: the client's retries and any re-send reuse it.
    n8nIdempotencyKey: randomUUID(),
    n8nCorrelationId: randomUUID(),
  });

  // n8n ("Immediately", no callback) and the audit entry run after the response: the visitor
  // does not wait for them.
  const idempotencyKey = lead.n8nIdempotencyKey!;
  const correlationId = lead.n8nCorrelationId!;
  after(async () => {
    try {
      // What the lead workflow needs from the form — not the IP, user agent or raw payload.
      const result = await triggerN8n(
        "lead-created",
        {
          leadId: lead.id,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          company: lead.company,
          website: lead.website,
          budget: lead.budget,
          message: lead.message,
          consentMarketing: lead.consentMarketing,
          source: lead.source,
          createdAt: lead.createdAt,
        },
        { idempotencyKey, correlationId },
      );
      if (!result.ok) console.error("lead.not_accepted_by_n8n", { leadId: lead.id, correlationId, status: result.status, reason: result.reason });
    } catch (error) {
      console.error("lead.trigger_failed", { leadId: lead.id, correlationId, reason: error instanceof Error ? error.message : "unknown" });
    }
    await logAudit("lead.created", lead.id);
  });

  return { status: "ok" };
}

// Server Actions are public POST endpoints: the dashboard's proxy.ts only checks that a
// cookie exists, so every action re-checks the session and that the lead belongs to the
// user's workspace (server-auth-actions).
async function authorizeLead(id: string) {
  const user = await getCurrentUser(); // no valid session -> redirect("/login")
  const [workspace, lead] = await Promise.all([getWorkspace(user.workspaceSlug), db.getLead(id)]);
  if (!lead || lead.workspaceId !== workspace.id) throw new Error("Lead not found");
  return lead;
}

export async function updateLeadStatus(id: string, status: LeadStatus) {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) throw new Error("Invalid status");
  const lead = await authorizeLead(id);
  await db.updateLeadStatus(lead.id, status);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/leads/${lead.id}`);
}

export async function deleteLead(id: string) {
  const lead = await authorizeLead(id);
  await db.deleteLead(lead.id);
  revalidatePath("/dashboard");
}
