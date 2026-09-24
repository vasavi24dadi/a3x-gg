// Admin actions from the control room: fix ownership, set a next action,
// escalate to Control Tower, or resolve a screenshot row. Every change is
// written to the audit history so nothing is silent.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";

type Base = { leadId: string; by?: string | null; reason?: string | null };

async function authenticatedActor() {
  const request = getRequest();
  const token = request?.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (token && url && key) {
    const db = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data } = await db.auth.getUser(token);
    if (data.user) {
      return {
        id: data.user.id,
        label: (data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email || data.user.id).slice(0, 80),
      };
    }
  }
  return { id: null, label: "Admin control" };
}

async function audit(input: {
  entity: string;
  entityId: string;
  action: string;
  actor: { id: string | null; label: string };
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    entity: input.entity,
    entity_id: input.entityId,
    actor: input.actor.label,
    action: input.action,
    prev: { actorId: input.actor.id, before: input.before ?? null } as unknown as Json,
    next: { after: input.after ?? null } as unknown as Json,
    reason: (input.reason ?? "").slice(0, 400) || null,
    at: new Date().toISOString(),
  });
  if (error) throw new Error(`Audit log failed: ${error.message}`);
}

export const assignOwner = createServerFn({ method: "POST" })
  .inputValidator((input: Base & { handler: string }) => {
    if (!input?.leadId) throw new Error("leadId is required");
    if (!input?.handler?.trim()) throw new Error("Type who takes this customer");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actorInfo = await authenticatedActor();
    const handler = data.handler.trim().slice(0, 80);
    const { data: before, error: readError } = await supabaseAdmin
      .from("leads")
      .select("current_handler_name, current_owner")
      .eq("id", data.leadId)
      .single();
    if (readError) throw new Error(readError.message);
    const { error } = await supabaseAdmin
      .from("leads")
      .update({ current_handler_name: handler, last_operator_action_at: new Date().toISOString() })
      .eq("id", data.leadId);
    if (error) throw new Error(error.message);
    await audit({
      entity: "lead", entityId: data.leadId, action: `owner set to ${handler}`,
      actor: actorInfo, reason: data.reason,
      before: { current_handler_name: before.current_handler_name, current_owner: before.current_owner },
      after: { current_handler_name: handler },
    });
    return { ok: true as const, handler };
  });

export const setNextAction = createServerFn({ method: "POST" })
  .inputValidator((input: Base & { kind: string; dueInMinutes?: number }) => {
    if (!input?.leadId) throw new Error("leadId is required");
    if (!input?.kind?.trim()) throw new Error("Say what must happen next");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actorInfo = await authenticatedActor();
    const dueAt = new Date(Date.now() + (data.dueInMinutes ?? 120) * 60000).toISOString();
    const kind = data.kind.trim().slice(0, 80);
    const { data: before, error: readError } = await supabaseAdmin
      .from("next_actions")
      .select("id, kind, due_at, status, done_at, notes")
      .eq("lead_id", data.leadId)
      .is("done_at", null)
      .order("due_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const { error } = await supabaseAdmin.from("next_actions").insert({
      lead_id: data.leadId,
      kind,
      due_at: dueAt,
      status: "open",
      source: "admin_control",
      notes: (data.reason ?? "Set from Admin Draft Control").slice(0, 400),
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("leads")
      .update({ last_operator_action_at: new Date().toISOString() })
      .eq("id", data.leadId);
    await audit({
      entity: "lead", entityId: data.leadId, action: `next action: ${kind}`,
      actor: actorInfo, reason: data.reason,
      before: before ?? null,
      after: { kind, due_at: dueAt, status: "open" },
    });
    return { ok: true as const, kind, dueAt };
  });

export const escalateToTower = createServerFn({ method: "POST" })
  .inputValidator((input: Base) => {
    if (!input?.leadId) throw new Error("leadId is required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actorInfo = await authenticatedActor();
    const { data: before, error: readError } = await supabaseAdmin
      .from("leads")
      .select("current_handler_name, primary_blocker, current_owner")
      .eq("id", data.leadId)
      .single();
    if (readError) throw new Error(readError.message);
    const blocker = (data.reason ?? "Escalated: nobody moved this in time").slice(0, 200);
    const { error } = await supabaseAdmin
      .from("leads")
      .update({
        current_handler_name: "Control Tower",
        primary_blocker: blocker,
        last_operator_action_at: new Date().toISOString(),
      })
      .eq("id", data.leadId);
    if (error) throw new Error(error.message);
    await audit({
      entity: "lead", entityId: data.leadId, action: "escalated to Control Tower",
      actor: actorInfo, reason: data.reason,
      before: { current_handler_name: before.current_handler_name, current_owner: before.current_owner, primary_blocker: before.primary_blocker },
      after: { current_handler_name: "Control Tower", primary_blocker: blocker },
    });
    return { ok: true as const };
  });

export const resolveRow = createServerFn({ method: "POST" })
  .inputValidator((input: { observationId: string; decision: "reconciled" | "non_customer"; by?: string | null; reason?: string | null }) => {
    if (!input?.observationId) throw new Error("observationId is required");
    return input;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actorInfo = await authenticatedActor();
    const { data: before, error: readError } = await supabaseAdmin
      .from("screenshot_observations")
      .select("reconciliation_state, reconciliation_reason, lead_id")
      .eq("id", data.observationId)
      .single();
    if (readError) throw new Error(readError.message);
    const reason = (data.reason ?? "decided in Admin control").slice(0, 200);
    const { error } = await supabaseAdmin
      .from("screenshot_observations")
      .update({ reconciliation_state: data.decision, reconciliation_reason: reason })
      .eq("id", data.observationId);
    if (error) throw new Error(error.message);
    await audit({
      entity: "screenshot_observation", entityId: data.observationId, action: `row ${data.decision}`,
      actor: actorInfo, reason: data.reason,
      before: { reconciliation_state: before.reconciliation_state, reconciliation_reason: before.reconciliation_reason, lead_id: before.lead_id },
      after: { reconciliation_state: data.decision, reconciliation_reason: reason, lead_id: before.lead_id },
    });
    return { ok: true as const };
  });
