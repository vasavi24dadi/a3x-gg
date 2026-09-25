// Turns the raw control read into the numbers and queues the admin room shows.
// Nothing is invented here: every count traces back to a row the server returned.
import type { ControlData, ControlBatch, ControlObservation } from "@/lib/admin-control/data.functions";
import { windowStart, type ControlFilters } from "./filters";

export type Health = "RED" | "AMBER" | "GREEN" | "GREY";

export const LEAKS = [
  ["no_owner", "Nobody owns it"],
  ["no_next_action", "No next action"],
  ["overdue_action", "Next action overdue"],
  ["unread_unattended", "Unread reply unattended"],
  ["stale_evidence", "WhatsApp moved, CRM did not"],
  ["stuck_stage", "Stuck in same stage"],
  ["review_pending", "Row still needs review"],
] as const;

export type LeakKey = (typeof LEAKS)[number][0];

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  zone: string;
  stage: string;
  status: string;
  blocker?: string | null;
  journeyStep: string;
  journeyIndex: number;
  bucket: string;
  handler: string;
  owned: boolean;
  wa: string;
  obsCount: number;
  lastObsAt: number;
  lastActionAt: number;
  unread: number;
  preview: string;
  workOperator: string;
  workState: string;
  score: number;
  nextActionKind: string;
  nextActionAt: number;
  overdueMins: number;
  health: Health;
  reasons: string[];
  leaks: LeakKey[];
  reviewRows: number;
}

export interface Derived {
  batches: ControlBatch[];
  observations: ControlObservation[];
  rows: CustomerRow[];
  kpi: {
    screenshots: number;
    detected: number;
    expected: number;
    silentDrops: number;
    review: number;
    nonCustomer: number;
    customersSeen: number;
    newCustomers: number;
    accounts: number;
    openBatches: number;
    closedBatches: number;
    assigned: number;
    completed: number;
    completionPct: number;
    handlers: number;
    red: number;
    amber: number;
    green: number;
    grey: number;
    overdue: number;
    unownedActive: number;
    avgConfidence: number;
    lowConfidence: number;
  };
  funnel: Array<{ stage: string; count: number }>;
  journey: Array<{ step: string; count: number }>;
  leakCounts: Array<{ key: LeakKey; label: string; count: number }>;
  accounts: Array<{ wa: string; batches: number; detected: number; drops: number; review: number; lastAt: number }>;
  operators: Array<{
    operator: string;
    batches: number;
    assigned: number;
    done: number;
    donePct: number;
    active: number;
    red: number;
    dispositions: Array<[string, number]>;
  }>;
  reviewReasons: Array<[string, number]>;
  dayTrend: Array<{ day: string; detected: number; customers: number; review: number }>;
  options: { accounts: string[]; operators: string[]; zones: string[]; stages: string[] };
}

const ts = (v?: string | null) => (v ? Date.parse(v) : 0);
const mins = (from: number) => Math.round((Date.now() - from) / 60000);

export function derive(data: ControlData, f: ControlFilters): Derived {
  const from = windowStart(f.day);

  const options = {
    accounts: [...new Set(data.batches.map((b) => b.whatsappAccount).filter(Boolean) as string[])].sort(),
    operators: [...new Set(data.workBatches.map((b) => b.operator).filter(Boolean) as string[])].sort(),
    zones: [...new Set(data.leads.map((l) => l.zone).filter(Boolean) as string[])].sort().slice(0, 40),
    stages: [...new Set(data.leads.map((l) => l.stage).filter(Boolean) as string[])].sort(),
  };

  const batches = data.batches.filter(
    (b) => ts(b.uploadedAt) >= from && (f.wa === "all" || b.whatsappAccount === f.wa),
  );
  const batchIds = new Set(batches.map((b) => b.id));
  const observations = data.observations.filter(
    (o) => (o.batchId ? batchIds.has(o.batchId) : ts(o.capturedAt) >= from) && (f.wa === "all" || o.whatsappAccount === f.wa),
  );

  // per-customer evidence
  const obsByLead = new Map<string, ControlObservation[]>();
  observations.forEach((o) => {
    if (!o.leadId) return;
    const arr = obsByLead.get(o.leadId) ?? [];
    arr.push(o);
    obsByLead.set(o.leadId, arr);
  });

  const itemByLead = new Map<string, { operator: string; state: string; score: number }>();
  const opOfBatch = new Map(data.workBatches.map((b) => [b.id, b.operator ?? "—"]));
  data.workItems.forEach((i) => {
    if (!i.leadId) return;
    itemByLead.set(i.leadId, {
      operator: (i.batchId && opOfBatch.get(i.batchId)) || "—",
      state: i.state ?? "drafted",
      score: i.score ?? 0,
    });
  });

  const openAction = new Map<string, { kind: string; at: number }>();
  data.actions.forEach((a) => {
    if (!a.leadId || a.doneAt) return;
    const at = ts(a.dueAt);
    const cur = openAction.get(a.leadId);
    if (!cur || at < cur.at) openAction.set(a.leadId, { kind: a.kind ?? "Follow up", at });
  });

  let rows: CustomerRow[] = data.leads.map((l) => {
    const obs = obsByLead.get(l.id) ?? [];
    const lastObsAt = Math.max(ts(l.lastObservationAt), ...obs.map((o) => ts(o.capturedAt)), 0);
    const lastActionAt = Math.max(ts(l.lastActionAt), 0);
    const work = itemByLead.get(l.id);
    const act = openAction.get(l.id);
    const overdue = act ? Math.round((Date.now() - act.at) / 60000) : 0;
    const unread = Math.max(l.unread ?? 0, ...obs.map((o) => o.unreadCount ?? 0), 0);
    const handler = l.handler ?? work?.operator ?? "";
    const owned = Boolean(handler && handler !== "—");
    const reviewRows = obs.filter((o) => o.state === "needs_review").length;

    const leaks: LeakKey[] = [];
    const reasons: string[] = [];
    if (!owned) {
      leaks.push("no_owner");
      reasons.push("no owner or live handler");
    }
    if (!act) {
      leaks.push("no_next_action");
      reasons.push("no dated next action");
    }
    if (act && overdue > 0) {
      leaks.push("overdue_action");
      reasons.push(`next action overdue ${overdue}m`);
    }
    if (unread > 0 && !owned) {
      leaks.push("unread_unattended");
      reasons.push(`${unread} unread with nobody on it`);
    }
    if (lastObsAt && lastActionAt && lastObsAt > lastActionAt) {
      leaks.push("stale_evidence");
      reasons.push("WhatsApp moved after the last CRM action");
    }
    if (lastActionAt && mins(lastActionAt) > 48 * 60 && l.stage !== "BOOKED") {
      leaks.push("stuck_stage");
      reasons.push(`no movement for ${Math.round(mins(lastActionAt) / 60)}h`);
    }
    if (reviewRows) {
      leaks.push("review_pending");
      reasons.push(`${reviewRows} screenshot row(s) still unresolved`);
    }

    let health: Health = "GREEN";
    if (l.stage === "BOOKED" || l.status === "lost") health = "GREY";
    else if (leaks.includes("no_owner") || leaks.includes("unread_unattended") || overdue > 120) health = "RED";
    else if (leaks.length) health = "AMBER";
    else if (act && act.at > Date.now() + 24 * 3600_000) health = "GREY";

    return {
      id: l.id,
      name: l.name ?? "Unknown",
      phone: l.phone ?? "",
      zone: l.zone ?? "—",
      stage: l.stage ?? "NEW",
      status: l.status ?? "",
      blocker: l.blocker ?? null,
      journeyStep: l.journeyStep ?? "—",
      journeyIndex: l.journeyIndex ?? 0,
      bucket: l.bucket ?? obs[0]?.bucket ?? "—",
      handler: handler || "Unassigned",
      owned,
      wa: obs[0]?.whatsappAccount ?? "—",
      obsCount: obs.length,
      lastObsAt,
      lastActionAt,
      unread,
      preview: obs[0]?.preview ?? l.lastMessage ?? "",
      workOperator: work?.operator ?? "—",
      workState: work?.state ?? "not drafted",
      score: work?.score ?? 0,
      nextActionKind: act?.kind ?? "",
      nextActionAt: act?.at ?? 0,
      overdueMins: overdue,
      health,
      reasons,
      leaks,
      reviewRows,
    };
  });

  if (f.operator !== "all") rows = rows.filter((r) => r.handler === f.operator || r.workOperator === f.operator);
  if (f.zone !== "all") rows = rows.filter((r) => r.zone === f.zone);
  if (f.stage !== "all") rows = rows.filter((r) => r.stage === f.stage);
  if (f.health !== "all") rows = rows.filter((r) => r.health === f.health);
  if (f.leak !== "all") rows = rows.filter((r) => r.leaks.includes(f.leak as LeakKey));
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    const d = q.replace(/\D/g, "");
    rows = rows.filter((r) =>
      d.length >= 3 ? r.phone.replace(/\D/g, "").includes(d) : r.name.toLowerCase().includes(q),
    );
  }
  rows.sort(
    (a, b) =>
      Number(b.health === "RED") - Number(a.health === "RED") ||
      b.overdueMins - a.overdueMins ||
      b.lastObsAt - a.lastObsAt,
  );

  const expected = batches.reduce((s, b) => s + (b.expected ?? 0), 0);
  const detected = batches.reduce((s, b) => s + (b.detected ?? 0), 0);
  const review = observations.filter((o) => o.state === "needs_review").length;
  const nonCustomer = observations.filter((o) => o.state === "non_customer").length;
  const confidences = observations.map((o) => o.ocrConfidence ?? 0).filter(Boolean);
  const leadIdsSeen = new Set(observations.map((o) => o.leadId).filter(Boolean) as string[]);
  const workBatches = data.workBatches.filter(
    (b) => ts(b.createdAt) >= from && (f.operator === "all" || b.operator === f.operator),
  );
  const wbIds = new Set(workBatches.map((b) => b.id));
  const items = data.workItems.filter((i) => i.batchId && wbIds.has(i.batchId));

  const kpi = {
    screenshots: batches.reduce((s, b) => s + (b.screenshotCount ?? 0), 0),
    detected,
    expected,
    silentDrops: Math.max(0, expected - detected),
    review,
    nonCustomer,
    customersSeen: leadIdsSeen.size,
    newCustomers: observations.filter((o) => o.state === "new_customer").length,
    accounts: new Set(batches.map((b) => b.whatsappAccount)).size,
    openBatches: workBatches.filter((b) => b.status === "open").length,
    closedBatches: workBatches.filter((b) => b.status !== "open").length,
    assigned: items.length,
    completed: items.filter((i) => i.state === "done").length,
    completionPct: items.length ? Math.round((items.filter((i) => i.state === "done").length / items.length) * 100) : 0,
    handlers: new Set(rows.filter((r) => r.owned).map((r) => r.handler)).size,
    red: rows.filter((r) => r.health === "RED").length,
    amber: rows.filter((r) => r.health === "AMBER").length,
    green: rows.filter((r) => r.health === "GREEN").length,
    grey: rows.filter((r) => r.health === "GREY").length,
    overdue: rows.filter((r) => r.overdueMins > 0).length,
    unownedActive: rows.filter((r) => !r.owned && r.health !== "GREY").length,
    avgConfidence: confidences.length
      ? Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length)
      : 0,
    lowConfidence: observations.filter((o) => (o.ocrConfidence ?? 100) < 70).length,
  };

  const tally = <T,>(arr: T[], key: (t: T) => string) => {
    const m = new Map<string, number>();
    arr.forEach((x) => {
      const k = key(x) || "—";
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const funnel = tally(rows, (r) => r.stage).map(([stage, count]) => ({ stage, count }));
  const journey = tally(rows, (r) => r.journeyStep).map(([step, count]) => ({ step, count }));

  const accounts = options.accounts
    .map((wa) => {
      const bs = batches.filter((b) => b.whatsappAccount === wa);
      return {
        wa,
        batches: bs.length,
        detected: bs.reduce((s, b) => s + (b.detected ?? 0), 0),
        drops: bs.reduce((s, b) => s + Math.max(0, (b.expected ?? 0) - (b.detected ?? 0)), 0),
        review: bs.reduce((s, b) => s + (b.unresolved ?? 0), 0),
        lastAt: Math.max(0, ...bs.map((b) => ts(b.uploadedAt))),
      };
    })
    .filter((a) => a.batches > 0)
    .sort((a, b) => b.drops - a.drops || b.detected - a.detected);

  const operators = options.operators
    .map((operator) => {
      const bs = workBatches.filter((b) => b.operator === operator);
      const ids = new Set(bs.map((b) => b.id));
      const its = items.filter((i) => i.batchId && ids.has(i.batchId));
      const leadSet = new Set(its.map((i) => i.leadId));
      const done = its.filter((i) => i.state === "done").length;
      return {
        operator,
        batches: bs.length,
        assigned: its.length,
        done,
        donePct: its.length ? Math.round((done / its.length) * 100) : 0,
        active: its.filter((i) => i.state === "active").length,
        red: rows.filter((r) => leadSet.has(r.id) && r.health === "RED").length,
        dispositions: tally(its.filter((i) => i.disposition), (i) => i.disposition ?? "—").slice(0, 4),
      };
    })
    .filter((o) => o.batches > 0)
    .sort((a, b) => a.donePct - b.donePct);

  const dayMap = new Map<string, { detected: number; customers: Set<string>; review: number }>();
  observations.forEach((o) => {
    const day = (o.capturedAt ?? "").slice(0, 10) || "—";
    const rec = dayMap.get(day) ?? { detected: 0, customers: new Set<string>(), review: 0 };
    rec.detected += 1;
    if (o.leadId) rec.customers.add(o.leadId);
    if (o.state === "needs_review") rec.review += 1;
    dayMap.set(day, rec);
  });

  return {
    batches,
    observations,
    rows,
    kpi,
    funnel,
    journey,
    leakCounts: LEAKS.map(([key, label]) => ({
      key,
      label,
      count: rows.filter((r) => r.leaks.includes(key)).length,
    })),
    accounts,
    operators,
    reviewReasons: tally(
      observations.filter((o) => o.state === "needs_review"),
      (o) => o.reason ?? "unspecified",
    ),
    dayTrend: [...dayMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 10)
      .map(([day, r]) => ({ day, detected: r.detected, customers: r.customers.size, review: r.review })),
    options,
  };
}
