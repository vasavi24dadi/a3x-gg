import { supabase } from "@/integrations/supabase/client";
import type { FlowEvent, FlowLead } from "./types";

const db = supabase as any;
const isoNow = () => new Date().toISOString();

export interface HostedFlowMatch {
  localId: string;
  hostedLeadId: string;
  hostedNextActionId: string | null;
  owner: string | null;
  stage: string;
  mission: string | null;
  blocker: string | null;
  moveInDate: string | null;
  lastMessage: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
}

export interface HostedFlowEventInput {
  activity: string;
  detail?: string | null;
  fromStage?: string | null;
  toStage?: string | null;
  nextAction?: string | null;
  deadline?: string | null;
  before?: unknown;
  after?: unknown;
}

function phoneKey(phone?: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export async function loadHostedFlowMatches(localLeads: FlowLead[]): Promise<HostedFlowMatch[]> {
  const [{ data: hosted, error: leadError }, { data: actions, error: actionError }] = await Promise.all([
    db.from("leads").select("id, phone, current_handler_name, current_pipeline_stage, current_mission, primary_blocker, movein_date, last_wa_message, latest_whatsapp_preview").limit(5000),
    db.from("next_actions").select("id, lead_id, kind, due_at, done_at").is("done_at", null).order("due_at", { ascending: true }).limit(10000),
  ]);
  if (leadError) throw leadError;
  if (actionError) throw actionError;

  const localByPhone = new Map<string, FlowLead[]>();
  for (const lead of localLeads) {
    const key = phoneKey(lead.phone);
    if (!key) continue;
    const rows = localByPhone.get(key) ?? [];
    rows.push(lead);
    localByPhone.set(key, rows);
  }
  const hostedPhoneCounts = new Map<string, number>();
  for (const lead of hosted ?? []) {
    const key = phoneKey(lead.phone);
    if (key) hostedPhoneCounts.set(key, (hostedPhoneCounts.get(key) ?? 0) + 1);
  }
  const actionByLead = new Map<string, any>();
  for (const action of actions ?? []) if (!actionByLead.has(action.lead_id)) actionByLead.set(action.lead_id, action);

  return (hosted ?? []).flatMap((lead: any) => {
    const key = phoneKey(lead.phone);
    if (!key || hostedPhoneCounts.get(key) !== 1) return [];
    const matches = localByPhone.get(key) ?? [];
    if (matches.length !== 1) return [];
    const action = actionByLead.get(lead.id);
    return [{
      localId: matches[0]!.id,
      hostedLeadId: lead.id,
      hostedNextActionId: action?.id ?? null,
      owner: lead.current_handler_name,
      stage: lead.current_pipeline_stage ?? "NEW",
      mission: lead.current_mission ?? null,
      blocker: lead.primary_blocker ?? null,
      moveInDate: lead.movein_date ?? null,
      lastMessage: lead.last_wa_message ?? lead.latest_whatsapp_preview ?? null,
      nextAction: action?.kind ?? null,
      nextActionAt: action?.due_at ?? null,
    } satisfies HostedFlowMatch];
  });
}

async function operator() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { id: null, name: "Booking Flow" };
  const user = data.user;
  return {
    id: user.id,
    name: (user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Operator") as string,
  };
}

export async function persistFlowLead(input: {
  lead: FlowLead;
  event: HostedFlowEventInput;
  patch?: Record<string, unknown>;
}) {
  if (!input.lead.hostedLeadId) return null;
  const actor = await operator();
  const update: Record<string, unknown> = { last_operator_action_at: isoNow() };
  if (input.patch) Object.assign(update, input.patch);
  const { data: before, error: readError } = await db.from("leads").select("current_handler_name, current_pipeline_stage, current_mission, primary_blocker, movein_date, last_operator_action_at").eq("id", input.lead.hostedLeadId).single();
  if (readError) throw readError;
  const { error: updateError } = await db.from("leads").update(update).eq("id", input.lead.hostedLeadId);
  if (updateError) throw updateError;
  const at = isoNow();
  const timeline = {
    lead_id: input.lead.hostedLeadId,
    actor: actor.name,
    activity: input.event.activity,
    at,
    prev_stage: input.event.fromStage ?? null,
    new_stage: input.event.toStage ?? null,
    next_action: input.event.nextAction ?? null,
    deadline: input.event.deadline ?? null,
    detail: input.event.detail ?? null,
  };
  const { error: timelineError } = await db.from("lead_timeline").insert(timeline);
  if (timelineError) throw timelineError;
  const { error: auditError } = await db.from("audit_logs").insert({
    entity: "lead",
    entity_id: input.lead.hostedLeadId,
    actor: actor.name,
    action: `booking_flow.${input.event.activity}`,
    prev: { actorId: actor.id, before: input.event.before ?? before },
    next: { after: input.event.after ?? update },
    reason: input.event.detail ?? null,
    at,
  });
  if (auditError) throw auditError;
  return { actor, at };
}

export async function persistFlowNextAction(lead: FlowLead, kind: string | null, dueAt: string | null, note?: string) {
  if (!lead.hostedLeadId) return null;
  const actor = await operator();
  if (!kind || !dueAt) {
    if (!lead.hostedNextActionId) return null;
    const { error } = await db.from("next_actions").update({ done_at: isoNow(), status: "done", updated_at: isoNow() }).eq("id", lead.hostedNextActionId).eq("lead_id", lead.hostedLeadId);
    if (error) throw error;
    return null;
  }
  const payload = { kind, due_at: dueAt, notes: note ?? null, owner_id: actor.id, updated_at: isoNow() };
  if (lead.hostedNextActionId) {
    const { error } = await db.from("next_actions").update(payload).eq("id", lead.hostedNextActionId).eq("lead_id", lead.hostedLeadId);
    if (error) throw error;
    return lead.hostedNextActionId;
  }
  const { data: existing, error: readError } = await db.from("next_actions").select("id").eq("lead_id", lead.hostedLeadId).is("done_at", null).order("due_at", { ascending: true }).limit(1).maybeSingle();
  if (readError) throw readError;
  if (existing?.id) {
    const { error } = await db.from("next_actions").update(payload).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await db.from("next_actions").insert({ ...payload, lead_id: lead.hostedLeadId, status: "open", source: "booking_flow_split", created_by: actor.id }).select("id").single();
  if (error) throw error;
  return data?.id ?? null;
}

export async function claimFlowLead(lead: FlowLead) {
  if (!lead.hostedLeadId) return null;
  const actor = await operator();
  if (!actor.id) throw new Error("Sign in required to claim this hosted customer");
  const { data, error } = await db.rpc("flow_claim_lead", {
    p_lead_id: lead.hostedLeadId,
    p_operator_id: actor.id,
    p_operator_name: actor.name,
    p_batch_id: null,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.ok) throw new Error(result?.reason || "This customer is being worked by another operator");
  return result.claim_id as string;
}

export async function heartbeatFlowClaim(claimId: string) {
  const actor = await operator();
  if (!actor.id) return false;
  const { data, error } = await db.rpc("flow_heartbeat_claim", { p_claim_id: claimId, p_operator_id: actor.id });
  if (error) throw error;
  return Boolean(data);
}

export async function releaseFlowClaim(claimId: string, reason = "released") {
  const actor = await operator();
  if (!actor.id) return false;
  const { data, error } = await db.rpc("flow_release_claim", { p_claim_id: claimId, p_operator_id: actor.id, p_reason: reason });
  if (error) throw error;
  return Boolean(data);
}

export function stagePatch(stage: string) {
  const normalized = stage.toUpperCase();
  const map: Record<string, string> = {
    WHERE: "NEW", CHANNEL: "CONTACTED", WHEN: "CONTACTED", OWN: "CONTACTED", RECON: "QUALIFIED",
    AREA: "QUALIFIED", FEASIBLE: "QUALIFIED", MOVEIN: "QUALIFIED", BUDGET: "QUALIFIED", ROOMTYPE: "QUALIFIED",
    INTENT: "QUALIFIED", CALL: "CONTACTED", REPLY: "CONTACTED", MATCH: "MATCHED", TOUR_READY: "TOUR_SCHEDULED",
    TOUR_SLOT: "TOUR_SCHEDULED", TOUR_CONFIRM: "TOUR_SCHEDULED", TOUR_VISIT: "POST_VISIT", TOUR_FEEDBACK: "POST_VISIT",
    QUOTE: "QUOTED", NEGOTIATE: "NEGOTIATION", BOOKING: "NEGOTIATION", APPROVAL: "NEGOTIATION",
    PAYMENT: "NEGOTIATION", RESERVED: "BOOKED", CUSTOMER_CONFIRM: "BOOKED", CHECKIN_PREP: "BOOKED",
    CHECKIN_DAY: "CHECKED_IN", SETTLED: "CHECKED_IN", CLOSED: "LOST", CONTROL_TOWER: "CONTROL_TOWER",
  };
  return map[normalized] ?? null;
}

export function flowEventFromLocal(event: FlowEvent): HostedFlowEventInput {
  return { activity: event.label, detail: event.detail ?? null };
}
