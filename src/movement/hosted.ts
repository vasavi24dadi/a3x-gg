import { supabase } from "@/integrations/supabase/client";
import type { FunnelStage, LockObjective, MovementEvent, MovementState, NextAction } from "./types";

export interface HostedMovementLead {
  id: string;
  phone: string | null;
  name: string | null;
  zone: string | null;
  stage: FunnelStage;
  ownerName: string;
  lastMessage: string | null;
  unread: number;
  moveInDate: string | null;
  nextAction: NextAction | null;
  nextActionId: string | null;
  history: MovementEvent[];
}

export interface HostedMovementSeed extends HostedMovementLead {
  localUlid: string;
}

const db = supabase as any;
const nowIso = () => new Date().toISOString();

const stageFromHosted: Record<string, FunnelStage> = {
  NEW: "new", DOSSIER: "new", CONTACTED: "qualified", QUALIFIED: "qualified",
  MATCHED: "matched", TOUR_SCHEDULED: "tour-scheduled", POST_VISIT: "tour-done",
  QUOTED: "quotation", NEGOTIATION: "negotiation", PAYMENT: "payment",
  BOOKED: "booked", CHECKED_IN: "check-in", LOST: "lost", FUTURE: "new",
};

const stageToHosted: Partial<Record<FunnelStage, string>> = {
  new: "NEW", qualified: "QUALIFIED", matched: "MATCHED", "tour-scheduled": "TOUR_SCHEDULED",
  "tour-done": "POST_VISIT", quotation: "QUOTED", negotiation: "NEGOTIATION",
  payment: "PAYMENT", booked: "BOOKED", "check-in": "CHECKED_IN", lost: "LOST",
};

async function currentOperator() {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  return {
    id: user.id,
    name: (user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "Operator") as string,
  };
}

export async function loadHostedMovementSeeds(localLeads: Array<{ ulid: string; phone: string; name: string }>): Promise<HostedMovementSeed[]> {
  const [{ data: leads, error: leadError }, { data: actions, error: actionError }, { data: timeline, error: timelineError }] = await Promise.all([
    db.from("leads").select("id, phone, wa_name, location_text, pipeline_stage, current_handler_name, last_wa_message, wa_unread_count, movein_date").limit(5000),
    db.from("next_actions").select("id, lead_id, kind, due_at, owner_id, notes, done_at").is("done_at", null).order("due_at", { ascending: true }).limit(10000),
    db.from("lead_timeline").select("id, lead_id, at, actor, activity, detail, prev_stage, new_stage, next_action, deadline").order("at", { ascending: false }).limit(10000),
  ]);
  if (leadError) throw leadError;
  if (actionError) throw actionError;
  if (timelineError) throw timelineError;

  const localByPhone = new Map<string, { ulid: string; phone: string; name: string }[]>();
  for (const local of localLeads) {
    const key = digits(local.phone);
    if (!key) continue;
    const rows = localByPhone.get(key) ?? [];
    rows.push(local);
    localByPhone.set(key, rows);
  }
  const actionByLead = new Map<string, any>();
  for (const action of actions ?? []) if (!actionByLead.has(action.lead_id)) actionByLead.set(action.lead_id, action);
  const hostedPhoneCounts = new Map<string, number>();
  for (const lead of leads ?? []) {
    const key = digits(lead.phone);
    if (key) hostedPhoneCounts.set(key, (hostedPhoneCounts.get(key) ?? 0) + 1);
  }
  const historyByLead = new Map<string, MovementEvent[]>();
  for (const item of timeline ?? []) {
    const rows = historyByLead.get(item.lead_id) ?? [];
    rows.push({
      id: `hosted-${item.id}`,
      ts: item.at,
      ulid: item.lead_id,
      kind: "hosted-history",
      actorId: item.actor ?? "hosted",
      actorName: item.actor ?? "Hosted history",
      text: [item.activity, item.detail].filter(Boolean).join(" · "),
      from: item.prev_stage ?? undefined,
      to: item.new_stage ?? undefined,
      meta: { nextAction: item.next_action, deadline: item.deadline },
    });
    historyByLead.set(item.lead_id, rows);
  }

  return (leads ?? []).flatMap((lead: any) => {
    const phone = digits(lead.phone);
    if (phone && (hostedPhoneCounts.get(phone) ?? 0) > 1) return [];
    const matches = phone ? localByPhone.get(phone) ?? [] : [];
    if (matches.length > 1) return [];
    const localUlid = matches[0]?.ulid ?? lead.id;
    const action = actionByLead.get(lead.id);
    return [{
      id: lead.id,
      localUlid,
      phone: lead.phone,
      name: lead.wa_name,
      zone: lead.location_text,
      stage: stageFromHosted[String(lead.pipeline_stage ?? "NEW").toUpperCase()] ?? "new",
      ownerName: lead.current_handler_name || "Unassigned",
      lastMessage: lead.last_wa_message,
      unread: Number(lead.wa_unread_count ?? 0),
      moveInDate: lead.movein_date,
      nextAction: action ? {
        kind: action.kind,
        dueAt: action.due_at,
        ownerId: action.owner_id ?? "",
        ownerName: lead.current_handler_name ?? "Unassigned",
        note: action.notes ?? undefined,
      } : null,
      nextActionId: action?.id ?? null,
      history: historyByLead.get(lead.id) ?? [],
    }];
  });
}

export async function claimHostedMovementLead(leadId: string, objective: LockObjective): Promise<{ claimId: string }> {
  const operator = await currentOperator();
  if (!operator) throw new Error("Sign in required to claim a hosted customer");
  const { data, error } = await db.rpc("flow_claim_lead", {
    p_lead_id: leadId,
    p_operator_id: operator.id,
    p_operator_name: operator.name,
    p_batch_id: null,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.ok) throw new Error(result?.reason || `Customer is already claimed for ${objective}`);
  return { claimId: result.claim_id };
}

export async function heartbeatHostedMovementClaim(claimId: string) {
  const operator = await currentOperator();
  if (!operator) return false;
  const { data, error } = await db.rpc("flow_heartbeat_claim", { p_claim_id: claimId, p_operator_id: operator.id });
  if (error) throw error;
  return Boolean(data);
}

export async function releaseHostedMovementClaim(claimId: string, reason = "released") {
  const operator = await currentOperator();
  if (!operator) return false;
  const { data, error } = await db.rpc("flow_release_claim", { p_claim_id: claimId, p_operator_id: operator.id, p_reason: reason });
  if (error) throw error;
  return Boolean(data);
}

export async function persistHostedMovementState(state: MovementState, patch: Partial<MovementState>) {
  if (!state.hostedLeadId) return;
  const update: Record<string, unknown> = { last_operator_action_at: nowIso() };
  if (patch.stage) update.current_pipeline_stage = stageToHosted[patch.stage] ?? patch.stage.toUpperCase();
  if (patch.primaryOwnerName) update.current_handler_name = patch.primaryOwnerName;
  if (patch.blocker !== undefined) update.primary_blocker = patch.blocker === "none" ? null : patch.blocker;
  if (patch.lastGharpayyMsg !== undefined) update.latest_whatsapp_preview = patch.lastGharpayyMsg;
  if (Object.keys(update).length === 1) return;
  const { error } = await db.from("leads").update(update).eq("id", state.hostedLeadId);
  if (error) throw error;
}

export async function persistHostedNextAction(state: MovementState, action: NextAction | null) {
  if (!state.hostedLeadId) return;
  const operator = await currentOperator();
  if (!operator) return;
  if (!action) {
    if (!state.hostedNextActionId) return null;
    const { error } = await db.from("next_actions").update({ done_at: nowIso(), status: "done", updated_at: nowIso() }).eq("id", state.hostedNextActionId);
    if (error) throw error;
    return null;
  }
  const payload = {
    kind: action.kind,
    due_at: action.dueAt,
    owner_id: action.ownerId || operator.id,
    notes: action.note ?? null,
    updated_at: nowIso(),
  };
  if (state.hostedNextActionId) {
    const { error } = await db.from("next_actions").update(payload).eq("id", state.hostedNextActionId).eq("lead_id", state.hostedLeadId);
    if (error) throw error;
    return state.hostedNextActionId;
  }
  const { data, error } = await db.from("next_actions").insert({ ...payload, lead_id: state.hostedLeadId, status: "open", source: "movement_os", created_by: operator.id }).select("id").single();
  if (error) throw error;
  return data?.id ?? null;
}

export async function appendHostedMovementEvent(state: MovementState, event: MovementEvent) {
  if (!state.hostedLeadId) return;
  const operator = await currentOperator();
  if (!operator) return;
  const { error } = await db.from("lead_timeline").insert({
    lead_id: state.hostedLeadId,
    actor: operator.name,
    activity: `movement_${event.kind}`,
    at: event.ts,
    new_stage: event.to ?? null,
    prev_stage: event.from ?? null,
    next_action: state.nextAction?.kind ?? null,
    deadline: state.nextAction?.dueAt ?? null,
    detail: event.text,
  });
  if (error) throw error;
}

export function hostedStateFromSeed(seed: HostedMovementSeed) {
  return {
    hostedLeadId: seed.id,
    hostedNextActionId: seed.nextActionId,
    name: seed.name ?? undefined,
    phone: seed.phone ?? undefined,
    zone: seed.zone ?? "",
    stage: seed.stage,
    primaryOwnerName: seed.ownerName,
    unread: seed.unread,
    lastCustomerMsg: seed.lastMessage,
    lastCustomerMsgAt: seed.lastMessage ? nowIso() : null,
    checkInDate: seed.moveInDate,
    nextAction: seed.nextAction,
  } satisfies Partial<MovementState>;
}

function digits(phone: string | null | undefined) {
  const value = (phone ?? "").replace(/\D/g, "");
  return value.length >= 10 ? value.slice(-10) : "";
}

