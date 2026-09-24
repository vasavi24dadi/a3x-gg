// One server read for the Admin Draft Control room: screenshots, observations,
// customers, work batches, next actions and history. Public read-only data only.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

export interface ControlBatch {
  id: string;
  whatsappAccount: string | null;
  checkpoint: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  captureStart: string | null;
  screenshotCount: number | null;
  expected: number | null;
  detected: number | null;
  reconciled: number | null;
  unresolved: number | null;
  status: string | null;
  duplicateRows: number;
  duplicateScreenshots: number;
  errors: number;
  processingMs: number | null;
}

export interface ControlObservation {
  id: string;
  batchId: string | null;
  leadId: string | null;
  whatsappAccount: string | null;
  contactName: string | null;
  phone: string | null;
  preview: string | null;
  direction: string | null;
  unread: boolean | null;
  unreadCount: number | null;
  seenState: string | null;
  label: string | null;
  bucket: string | null;
  stageInference: string | null;
  ocrConfidence: number | null;
  capturedAt: string | null;
  state: string | null;
  reason: string | null;
}

export interface ControlLead {
  id: string;
  name: string | null;
  phone: string | null;
  zone: string | null;
  stage: string | null;
  journeyStep: string | null;
  journeyIndex: number | null;
  priority: string | null;
  status: string | null;
  bucket: string | null;
  handler: string | null;
  ownerId: string | null;
  syncState: string | null;
  lastMessage: string | null;
  lastSeenAt: string | null;
  lastObservationAt: string | null;
  lastActionAt: string | null;
  unread: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  blocker: string | null;
  mission: string | null;
}

export interface ControlWorkBatch {
  id: string;
  operator: string | null;
  target: number | null;
  tray: number | null;
  status: string | null;
  createdAt: string | null;
  closedAt: string | null;
}

export interface ControlWorkItem {
  id: string;
  batchId: string | null;
  leadId: string | null;
  position: number | null;
  score: number | null;
  reasons: string[];
  state: string | null;
  disposition: string | null;
  completedAt: string | null;
}

export interface ControlAction {
  id: string;
  leadId: string | null;
  kind: string | null;
  dueAt: string | null;
  doneAt: string | null;
  status: string | null;
  priority: string | null;
  notes: string | null;
}

export interface ControlAudit {
  id: string;
  entity: string | null;
  entityId: string | null;
  action: string | null;
  by: string | null;
  reason: string | null;
  at: string | null;
}

export interface ControlData {
  batches: ControlBatch[];
  observations: ControlObservation[];
  leads: ControlLead[];
  workBatches: ControlWorkBatch[];
  workItems: ControlWorkItem[];
  actions: ControlAction[];
  audit: ControlAudit[];
  loadedAt: string;
}

export interface CustomerHistoryEntry {
  id: string;
  at: string;
  actor: string | null;
  action: string;
  reason: string | null;
  detail: string | null;
  source: "audit" | "timeline" | "next_action";
}

export const getAdminCustomerHistory = createServerFn({ method: "GET" })
  .inputValidator((input: { leadId: string }) => {
    if (!input?.leadId) throw new Error("leadId is required");
    return input;
  })
  .handler(async ({ data }): Promise<CustomerHistoryEntry[]> => {
    const db = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const [audit, timeline, actions] = await Promise.all([
      db
        .from("audit_logs")
        .select("id, entity, entity_id, actor, action, prev, next, reason, at")
        .eq("entity", "lead")
        .eq("entity_id", data.leadId)
        .order("at", { ascending: false })
        .limit(100),
      db
        .from("lead_timeline")
        .select("id, at, actor, activity, detail, next_action, deadline, new_owner, new_stage")
        .eq("lead_id", data.leadId)
        .order("at", { ascending: false })
        .limit(100),
      db
        .from("next_actions")
        .select("id, created_at, created_by, kind, due_at, done_at, status, notes, owner_id")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const failure = [audit, timeline, actions].find((result) => result.error);
    if (failure?.error) throw new Error(failure.error.message);

    const meta = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object" ? (value as Record<string, unknown>) : {};

    return [
      ...(audit.data ?? []).map((item) => ({
        id: item.id,
        at: item.at,
        actor: item.actor ?? (meta(item.prev)["by"] as string | null) ?? null,
        action: item.action,
        reason: item.reason,
        detail: [meta(item.prev)["before"], meta(item.next)["after"]]
          .filter(Boolean)
          .map((value) => JSON.stringify(value))
          .join(" → ") || null,
        source: "audit" as const,
      })),
      ...(timeline.data ?? []).map((item) => ({
        id: item.id,
        at: item.at,
        actor: item.actor,
        action: item.activity,
        reason: null,
        detail: [item.detail, item.next_action && `next: ${item.next_action}`, item.deadline && `due: ${item.deadline}`, item.new_owner && `owner: ${item.new_owner}`, item.new_stage && `stage: ${item.new_stage}`]
          .filter(Boolean)
          .join(" · ") || null,
        source: "timeline" as const,
      })),
      ...(actions.data ?? []).map((item) => ({
        id: item.id,
        at: item.created_at,
        actor: item.created_by,
        action: `Next action: ${item.kind}`,
        reason: item.notes,
        detail: [`due: ${item.due_at}`, item.done_at ? `done: ${item.done_at}` : `status: ${item.status}`, item.owner_id && `owner: ${item.owner_id}`]
          .filter(Boolean)
          .join(" · "),
        source: "next_action" as const,
      })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  });

export const getAdminControlData = createServerFn({ method: "GET" }).handler(async (): Promise<ControlData> => {
  const db = createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_PUBLISHABLE_KEY"]!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const [batches, observations, leads, workBatches, workItems, actions, audit] = await Promise.all([
    db
      .from("screenshot_batches")
      .select(
        "id, whatsapp_account, uploaded_at, capture_window_start, screenshot_count, visible_rows_expected, detected_rows_total, rows_reconciled, unresolved_count, status, metadata",
      )
      .order("uploaded_at", { ascending: false })
      .limit(300),
    db
      .from("screenshot_observations")
      .select(
        "id, batch_id, lead_id, whatsapp_account, contact_name, phone_normalized, last_message_preview, preview_direction, unread_visible, unread_count, seen_state, detected_label, work_bucket, stage_inference, ocr_confidence, captured_at, reconciliation_state, reconciliation_reason",
      )
      .order("captured_at", { ascending: false })
      .limit(3000),
    db
      .from("leads")
      .select(
        "id, wa_name, phone, location_text, pipeline_stage, journey_step, journey_step_index, priority, status, conversation_bucket, current_handler_name, current_owner, sync_state, last_wa_message, last_wa_seen_at, latest_whatsapp_observation_at, last_operator_action_at, wa_unread_count, created_at, updated_at, primary_blocker, current_mission",
      )
      .order("updated_at", { ascending: false })
      .limit(2000),
    db
      .from("flow_draft_batches")
      .select("id, operator_name, target_size, active_tray_size, status, created_at, closed_at")
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("flow_draft_items")
      .select("id, batch_id, lead_id, position, roi_score, roi_reasons, state, disposition, completed_at")
      .order("position", { ascending: true })
      .limit(4000),
    db
      .from("next_actions")
      .select("id, lead_id, kind, due_at, done_at, status, priority, notes")
      .order("due_at", { ascending: true })
      .limit(2000),
    db
      .from("audit_logs")
      .select("id, entity, entity_id, action, prev, reason, at")
      .order("at", { ascending: false })
      .limit(200),
  ]);

  const meta = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const num = (value: unknown) => (typeof value === "number" ? value : 0);

  return {
    loadedAt: new Date().toISOString(),
    batches: (batches.data ?? []).map((b) => {
      const m = meta(b.metadata);
      return {
        id: b.id,
        whatsappAccount: b.whatsapp_account,
        checkpoint: (m["checkpoint"] as string) ?? null,
        uploadedBy: (m["uploaded_by"] as string) ?? null,
        uploadedAt: b.uploaded_at,
        captureStart: b.capture_window_start,
        screenshotCount: b.screenshot_count,
        expected: b.visible_rows_expected,
        detected: b.detected_rows_total,
        reconciled: b.rows_reconciled,
        unresolved: b.unresolved_count,
        status: b.status,
        duplicateRows: num(m["duplicate_rows"]),
        duplicateScreenshots: num(m["duplicate_screenshots"]),
        errors: num(m["errors"]),
        processingMs: (m["processing_ms"] as number) ?? null,
      };
    }),
    observations: (observations.data ?? []).map((o) => ({
      id: o.id,
      batchId: o.batch_id,
      leadId: o.lead_id,
      whatsappAccount: o.whatsapp_account,
      contactName: o.contact_name,
      phone: o.phone_normalized,
      preview: o.last_message_preview,
      direction: o.preview_direction,
      unread: o.unread_visible,
      unreadCount: o.unread_count,
      seenState: o.seen_state,
      label: o.detected_label,
      bucket: o.work_bucket,
      stageInference: o.stage_inference,
      ocrConfidence: o.ocr_confidence === null ? null : Number(o.ocr_confidence),
      capturedAt: o.captured_at,
      state: o.reconciliation_state,
      reason: o.reconciliation_reason,
    })),
    leads: (leads.data ?? []).map((l) => ({
      id: l.id,
      name: l.wa_name,
      phone: l.phone,
      zone: l.location_text,
      stage: l.pipeline_stage,
      journeyStep: l.journey_step,
      journeyIndex: l.journey_step_index,
      priority: l.priority,
      status: l.status,
      bucket: l.conversation_bucket,
      handler: l.current_handler_name,
      ownerId: l.current_owner,
      syncState: l.sync_state,
      lastMessage: l.last_wa_message,
      lastSeenAt: l.last_wa_seen_at,
      lastObservationAt: l.latest_whatsapp_observation_at,
      lastActionAt: l.last_operator_action_at,
      unread: l.wa_unread_count,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
      blocker: l.primary_blocker,
      mission: l.current_mission,
    })),
    workBatches: (workBatches.data ?? []).map((b) => ({
      id: b.id,
      operator: b.operator_name,
      target: b.target_size,
      tray: b.active_tray_size,
      status: b.status,
      createdAt: b.created_at,
      closedAt: b.closed_at,
    })),
    workItems: (workItems.data ?? []).map((i) => ({
      id: i.id,
      batchId: i.batch_id,
      leadId: i.lead_id,
      position: i.position,
      score: i.roi_score === null ? null : Number(i.roi_score),
      reasons: (i.roi_reasons ?? []) as string[],
      state: i.state,
      disposition: i.disposition,
      completedAt: i.completed_at,
    })),
    actions: (actions.data ?? []).map((a) => ({
      id: a.id,
      leadId: a.lead_id,
      kind: a.kind,
      dueAt: a.due_at,
      doneAt: a.done_at,
      status: a.status,
      priority: a.priority,
      notes: a.notes,
    })),
    audit: (audit.data ?? []).map((a) => ({
      id: a.id,
      entity: a.entity,
      entityId: a.entity_id,
      action: a.action,
      by: (meta(a.prev)["by"] as string) ?? null,
      reason: a.reason,
      at: a.at,
    })),
  };
});
