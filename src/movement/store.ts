// Movement OS store — append-only events + six-dimension customer state.
// Every action writes exactly one event; every dashboard reads those events.
import { create, type StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import {
  LOCK_TTL, OPERATORS,
  type Blocker, type CallResult, type Checkpoint, type ConflictLog, type DraftBatch, type DraftCode,
  type FunnelStage, type LiveLock, type LockObjective, type LossReason, type MovementEvent,
  type MovementEventKind, type MovementState, type NextAction, type NextActionKind, type Operator,
  type Qualification, type Team, type TourOutcome, type TourResult, type UnmatchedChat, type WorkState,
  type BatchLabel,
} from "./types";
import { evaluateGoodLead } from "./priority";
import { canonicalCustomerId } from "@/lib/canonical/customer-id";
import {
  appendHostedMovementEvent,
  claimHostedMovementLead,
  heartbeatHostedMovementClaim,
  persistHostedMovementState,
  persistHostedNextAction,
  releaseHostedMovementClaim,
} from "./hosted";

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

export interface ShadowSeed {
  ulid: string;
  name?: string;
  phone?: string;
  waAccount?: string;
  zone?: string;
  ownerId?: string;
  ownerName?: string;
  lastCustomerMsgAt?: string | null;
  lastCustomerMsg?: string | null;
  unread?: number;
  checkInDate?: string | null;
  budget?: number | null;
  location?: string | null;
  roomType?: string | null;
  inBangalore?: boolean | null;
  hostedLeadId?: string;
  hostedNextActionId?: string | null;
  hostedState?: Partial<MovementState>;
  hostedEvents?: MovementEvent[];
}

export type ClaimResult = { ok: true } | { ok: false; holder: LiveLock };

export interface MovementStore {
  states: Record<string, MovementState>;
  events: MovementEvent[];
  batches: DraftBatch[];
  locks: Record<string, LiveLock>;
  unmatched: UnmatchedChat[];
  checkpoints: Checkpoint[];
  conflicts: ConflictLog[];
  actor: Operator;
  /** drafting selection (pre-batch) */
  selection: string[];
  activeBatchId: string | null;

  setActor: (a: Operator) => void;

  ensureShadow: (seed: ShadowSeed) => MovementState;
  ensureMany: (seeds: ShadowSeed[]) => void;

  log: (ulid: string, kind: MovementEventKind, text: string, extra?: Partial<MovementEvent>) => MovementEvent;
  patch: (ulid: string, p: Partial<MovementState>) => void;

  // selection + drafting
  toggleSelect: (ulid: string) => void;
  setSelection: (ulids: string[]) => void;
  clearSelection: () => void;
  startBatch: (label: BatchLabel, ulids: string[]) => DraftBatch;
  draft: (ulid: string, code: DraftCode, batchId?: string, position?: string) => void;
  markWaDraft: (ulid: string, code: DraftCode) => void;
  syncDraft: (ulid: string) => void;
  advanceBatch: (batchId: string, spentMs: number) => void;
  endBatch: (batchId: string) => void;

  // live lock
  attemptClaim: (ulid: string, objective: LockObjective, objectiveText: string) => ClaimResult;
  touchLock: (ulid: string) => void;
  release: (ulid: string) => void;
  lockOf: (ulid: string) => LiveLock | null;
  expireLocks: () => void;

  // execution
  startCall: (ulid: string) => void;
  logCall: (ulid: string, result: CallResult, note?: string) => void;
  sendMessage: (ulid: string, text: string) => void;
  customerReplied: (ulid: string, text?: string) => void;
  capture: (ulid: string, q: Partial<Qualification>) => void;
  qualify: (ulid: string, good: boolean, checkInDate?: string | null) => void;
  setStage: (ulid: string, stage: FunnelStage, text?: string) => void;
  setWork: (ulid: string, work: WorkState) => void;
  setNextAction: (ulid: string, a: NextAction) => void;
  completeNextAction: (ulid: string) => void;
  shareOptions: (ulid: string, count: number) => void;
  scheduleTour: (ulid: string, at: string, property?: string) => void;
  confirmTour: (ulid: string) => void;
  tourDone: (ulid: string) => void;
  recordTourResult: (ulid: string, r: TourResult) => void;
  tourOutcome: (ulid: string, outcome: TourOutcome) => void;
  prebook: (ulid: string, step: "eligible" | "pitched" | "interested" | "payment-intent") => void;
  sendQuote: (ulid: string) => void;
  setBlocker: (ulid: string, b: Blocker) => void;
  collectPayment: (ulid: string, amount?: number) => void;
  book: (ulid: string) => void;
  checkIn: (ulid: string) => void;
  exit: (ulid: string, reason: LossReason, note?: string) => void;

  // handoffs
  handoff: (ulid: string, to: Team) => void;
  ackHandoff: (ulid: string) => void;
  transferPrimary: (ulid: string, op: Operator) => void;

  // unmatched
  addUnmatched: (u: Omit<UnmatchedChat, "id" | "ts" | "retries">) => void;
  retryUnmatched: (id: string) => void;
  resolveUnmatched: (id: string) => void;

  snapshot: (c: Omit<Checkpoint, "id" | "at">) => void;
  reset: () => void;
}

export function blank(seed: ShadowSeed): MovementState {
  const ts = now();
  return {
    ulid: seed.ulid,
    canonicalId: canonicalCustomerId({ phone: seed.phone, name: seed.name }) || seed.ulid,
    hostedLeadId: seed.hostedLeadId,
    hostedNextActionId: seed.hostedNextActionId ?? null,
    name: seed.name,
    phone: seed.phone,
    waAccount: seed.waAccount ?? "Kora WA 1",
    zone: seed.zone ?? "",
    identity: "shadow",
    waDraft: null,
    crmDraft: null,
    stage: "new",
    work: "available",
    primaryOwnerId: seed.ownerId ?? "",
    primaryOwnerName: seed.ownerName ?? "Unassigned",
    currentOperatorId: null,
    currentOperatorName: null,
    nextAction: null,
    customerWaitingSince: (seed.unread ?? 0) > 0 ? (seed.lastCustomerMsgAt ?? ts) : null,
    unread: seed.unread ?? 0,
    lastCustomerMsgAt: seed.lastCustomerMsgAt ?? null,
    lastCustomerMsg: seed.lastCustomerMsg ?? null,
    lastOutboundAt: null,
    lastGharpayyMsg: null,
    createdAt: ts,
    q: {
      budget: seed.budget ?? null, location: seed.location ?? null, roomType: seed.roomType ?? null,
      inBangalore: seed.inBangalore ?? null, moveInDate: seed.checkInDate ?? null,
    },
    goodLead: false,
    goodLeadReasons: [],
    checkInDate: seed.checkInDate ?? null,
    tourAt: null,
    tourProperty: null,
    tourConfirmed: false,
    tourDoneAt: null,
    tourOutcome: null,
    tourResult: null,
    prebook: { eligible: false, pitched: false, interested: false, paymentIntent: false, paid: false },
    blocker: "none",
    lossReason: null,
    paymentExpected: false,
    checkedInAt: null,
    handoffTo: null,
    conflicts: 0,
    updatedAt: ts,
  };
}

const TEAM_OWNER: Record<Team, Operator> = {
  "flow-ops": OPERATORS[0],
  tcm: OPERATORS.find((o) => o.role === "tcm")!,
  closing: OPERATORS.find((o) => o.role === "closing")!,
  ops: { id: "team-ops", name: "Ops Desk", role: "ops", zone: "ALL" },
};

const nextActionKindForTeam: Record<Team, NextActionKind> = {
  "flow-ops": "call", tcm: "confirm-tour", closing: "send-quote", ops: "recheck-later",
};

export const initialState = () => ({
  states: {} as Record<string, MovementState>,
  events: [] as MovementEvent[],
  batches: [] as DraftBatch[],
  locks: {} as Record<string, LiveLock>,
  unmatched: [] as UnmatchedChat[],
  checkpoints: [] as Checkpoint[],
  conflicts: [] as ConflictLog[],
  actor: OPERATORS[0],
  selection: [] as string[],
  activeBatchId: null as string | null,
});

export const movementCreator: StateCreator<MovementStore> = (set, get) => ({
  ...initialState(),

  setActor: (a) => set({ actor: a }),

  ensureShadow: (seed) => {
    const existing = get().states[seed.ulid];
    if (existing) return existing;
    const st = blank(seed);
    set((s) => ({ states: { ...s.states, [seed.ulid]: st } }));
    get().log(seed.ulid, "ingested", `Shadow lead created from WhatsApp (${st.waAccount})`, {
      actorId: "system", actorName: "System",
    });
    return get().states[seed.ulid];
  },

  ensureMany: (seeds) => {
    const cur = get().states;
    const add: Record<string, MovementState> = {};
    const hydrate: Record<string, Partial<MovementState>> = {};
    const evs: MovementEvent[] = [];
    const hostedEvents = seeds.flatMap((seed) => seed.hostedEvents ?? []);
    for (const seed of seeds) {
      if (cur[seed.ulid] || add[seed.ulid]) {
        if (seed.hostedLeadId) hydrate[seed.ulid] = { hostedLeadId: seed.hostedLeadId, hostedNextActionId: seed.hostedNextActionId ?? null, ...seed.hostedState };
        continue;
      }
      add[seed.ulid] = blank(seed);
      if (seed.hostedLeadId) hydrate[seed.ulid] = { hostedLeadId: seed.hostedLeadId, hostedNextActionId: seed.hostedNextActionId ?? null, ...seed.hostedState };
      evs.push({
        id: uid("ev"), ts: now(), ulid: seed.ulid, kind: "ingested",
        actorId: "system", actorName: "System",
        text: `Shadow lead created from WhatsApp (${add[seed.ulid].waAccount})`,
      });
    }
    if (!Object.keys(add).length) return;
    set((s) => ({
      states: {
        ...s.states,
        ...add,
        ...Object.fromEntries(Object.entries(hydrate).map(([ulid, patch]) => [ulid, { ...(s.states[ulid] ?? add[ulid]), ...patch, updatedAt: now() }])),
      },
      events: [...evs, ...hostedEvents.filter((event) => !s.events.some((existing) => existing.id === event.id)), ...s.events],
    }));
  },

  log: (ulid, kind, text, extra) => {
    const a = get().actor;
    const ev: MovementEvent = {
      id: uid("ev"), ts: now(), ulid, kind, actorId: a.id, actorName: a.name, text, ...extra,
    };
    set((s) => ({ events: [ev, ...s.events].slice(0, 6000) }));
    const state = get().states[ulid];
    if (state?.hostedLeadId) void appendHostedMovementEvent(state, ev).catch((error) => console.warn("Movement history not synced", error));
    return ev;
  },

  patch: (ulid, p) => {
    const before = get().states[ulid];
    set((s) => {
      const cur = s.states[ulid] ?? blank({ ulid });
      return { states: { ...s.states, [ulid]: { ...cur, ...p, updatedAt: now() } } };
    });
    const next = get().states[ulid];
    if (before?.hostedLeadId && next) {
      void persistHostedMovementState(next, p).catch((error) => console.warn("Movement state not synced", error));
      if (Object.prototype.hasOwnProperty.call(p, "nextAction")) {
        void persistHostedNextAction(next, next.nextAction ?? null).then((id) => {
          if (id && get().states[ulid]?.hostedNextActionId !== id) {
            set((s) => ({ states: { ...s.states, [ulid]: { ...s.states[ulid]!, hostedNextActionId: id } } }));
          }
        }).catch((error) => console.warn("Movement next action not synced", error));
      }
    }
  },

  toggleSelect: (ulid) =>
    set((s) => ({
      selection: s.selection.includes(ulid) ? s.selection.filter((u) => u !== ulid) : [...s.selection, ulid],
    })),
  setSelection: (ulids) => set({ selection: ulids }),
  clearSelection: () => set({ selection: [] }),

  startBatch: (label, ulids) => {
    const a = get().actor;
    const b: DraftBatch = {
      id: `${label}-B${String(get().batches.length + 1).padStart(2, "0")}`,
      label, size: ulids.length, ulids, startedAt: now(),
      operatorId: a.id, operatorName: a.name, cursor: 0, perLeadMs: [],
    };
    set((s) => ({ batches: [b, ...s.batches].slice(0, 80), activeBatchId: b.id, selection: [] }));
    for (const u of ulids) get().patch(u, { work: "drafting" });
    get().log(ulids[0] ?? "batch", "batch-started", `Batch ${b.id} started · ${ulids.length} chats`, { batchId: b.id });
    return b;
  },

  draft: (ulid, code, batchId, position) => {
    const prev = get().states[ulid]?.crmDraft ?? null;
    const a = get().actor;
    const st = get().states[ulid];
    get().patch(ulid, {
      crmDraft: code, waDraft: code, draftedAt: now(),
      draftedById: a.id, draftedByName: a.name, batchId, batchPosition: position,
      work: st?.nextAction ? "next-action-scheduled" : "available",
      primaryOwnerId: st?.primaryOwnerId || a.id,
      primaryOwnerName: st?.primaryOwnerId ? st.primaryOwnerName : a.name,
    });
    get().log(ulid, "drafted", `Drafted ${prev ?? "—"} → ${code}`, {
      from: prev ?? undefined, to: code, batchId, position,
    });
  },

  markWaDraft: (ulid, code) => {
    get().patch(ulid, { waDraft: code });
    get().log(ulid, "wa-draft", `WhatsApp label set to ${code}`, { to: code, actorId: "wa", actorName: "WhatsApp" });
  },

  syncDraft: (ulid) => {
    const st = get().states[ulid];
    if (!st?.waDraft) return;
    const prev = st.crmDraft;
    get().patch(ulid, { crmDraft: st.waDraft, draftedAt: now() });
    get().log(ulid, "draft-synced", `CRM draft synced ${prev ?? "—"} → ${st.waDraft}`, { from: prev ?? undefined, to: st.waDraft });
  },

  advanceBatch: (batchId, spentMs) =>
    set((s) => ({
      batches: s.batches.map((b) =>
        b.id === batchId
          ? { ...b, cursor: Math.min(b.cursor + 1, b.ulids.length), perLeadMs: [...b.perLeadMs, spentMs] }
          : b,
      ),
    })),

  endBatch: (batchId) => {
    const b = get().batches.find((x) => x.id === batchId);
    set((s) => ({
      batches: s.batches.map((x) => (x.id === batchId ? { ...x, endedAt: now() } : x)),
      activeBatchId: s.activeBatchId === batchId ? null : s.activeBatchId,
    }));
    if (b) {
      for (const u of b.ulids) {
        const st = get().states[u];
        if (st?.work === "drafting") get().patch(u, { work: st.nextAction ? "next-action-scheduled" : "available" });
      }
      const secs = Math.round(b.perLeadMs.reduce((a, c) => a + c, 0) / 1000);
      get().log(b.ulids[0] ?? "batch", "batch-ended", `Batch ${b.id} ended · ${b.perLeadMs.length}/${b.size} drafted in ${secs}s`, { batchId: b.id });
    }
  },

  attemptClaim: (ulid, objective, objectiveText) => {
    get().expireLocks();
    const a = get().actor;
    const held = get().locks[ulid];
    if (held && held.operatorId !== a.id) {
      const st = get().states[ulid];
      set((s) => ({
        conflicts: [{
          id: uid("cf"), ts: now(), ulid, byId: a.id, byName: a.name,
          holderName: held.operatorName, waAccount: st?.waAccount ?? "",
        }, ...s.conflicts].slice(0, 500),
      }));
      get().patch(ulid, { conflicts: (st?.conflicts ?? 0) + 1 });
      get().log(ulid, "conflict", `Duplicate work prevented — ${a.name} blocked, ${held.operatorName} holds the lock`);
      return { ok: false, holder: held };
    }
    const lock: LiveLock = {
      ulid, operatorId: a.id, operatorName: a.name, startedAt: held?.startedAt ?? now(),
      objective, objectiveText, ttlMins: LOCK_TTL[objective], lastTouchAt: now(),
    };
    set((s) => ({ locks: { ...s.locks, [ulid]: lock } }));
    const st = get().states[ulid];
    get().patch(ulid, {
      work: "in-work", currentOperatorId: a.id, currentOperatorName: a.name,
      primaryOwnerId: st?.primaryOwnerId || a.id,
      primaryOwnerName: st?.primaryOwnerId ? st.primaryOwnerName : a.name,
    });
    if (!held) get().log(ulid, "claimed", `Live lock by ${a.name} · ${objectiveText} · ${LOCK_TTL[objective]}m idle TTL`);
    if (!held && st?.hostedLeadId) {
      void claimHostedMovementLead(st.hostedLeadId, objective).then(({ claimId }) => {
        if (get().locks[ulid]) {
          set((s) => ({ locks: { ...s.locks, [ulid]: { ...s.locks[ulid]!, hostedClaimId: claimId } } }));
        } else {
          void releaseHostedMovementClaim(claimId).catch((error) => console.warn("Orphaned Movement claim release failed", error));
        }
      }).catch((error) => {
        get().release(ulid);
        get().log(ulid, "conflict", `Hosted claim failed: ${error instanceof Error ? error.message : "claim unavailable"}`, { actorId: "system", actorName: "System" });
      });
    }
    return { ok: true };
  },

  touchLock: (ulid) => {
    set((s) =>
      s.locks[ulid] ? { locks: { ...s.locks, [ulid]: { ...s.locks[ulid], lastTouchAt: now() } } } : {},
    );
    const lock = get().locks[ulid];
    if (lock?.hostedClaimId) void heartbeatHostedMovementClaim(lock.hostedClaimId).catch((error) => console.warn("Movement claim heartbeat failed", error));
  },

  release: (ulid) => {
    const existing = get().locks[ulid];
    if (!existing) return;
    if (existing.hostedClaimId) void releaseHostedMovementClaim(existing.hostedClaimId).catch((error) => console.warn("Movement claim release failed", error));
    set((s) => {
      const l = { ...s.locks };
      delete l[ulid];
      return { locks: l };
    });
    const st = get().states[ulid];
    const terminal = st?.stage === "booked" || st?.stage === "lost" || st?.stage === "check-in";
    get().patch(ulid, {
      currentOperatorId: null, currentOperatorName: null,
      work: st?.handoffTo && !st.handoffAckAt ? "handoff-pending"
        : st?.nextAction ? "next-action-scheduled"
          : terminal ? "completed-for-now"
            : st?.customerWaitingSince ? "available" : "completed-for-now",
    });
    get().log(ulid, "released", "Live lock released");
  },

  lockOf: (ulid) => {
    const l = get().locks[ulid];
    if (!l) return null;
    const idleMins = (Date.now() - +new Date(l.lastTouchAt)) / 60000;
    if (idleMins > l.ttlMins) return null;
    return l;
  },

  expireLocks: () => {
    const dead = Object.values(get().locks).filter(
      (l) => (Date.now() - +new Date(l.lastTouchAt)) / 60000 > l.ttlMins,
    );
    for (const l of dead) {
      set((s) => {
        const c = { ...s.locks };
        delete c[l.ulid];
        return { locks: c };
      });
      const st = get().states[l.ulid];
      get().patch(l.ulid, {
        currentOperatorId: null, currentOperatorName: null,
        work: st?.nextAction ? "next-action-scheduled" : "available",
      });
      get().log(l.ulid, "released", `Lock auto-released after ${l.ttlMins}m idle (${l.operatorName})`, { actorId: "system", actorName: "System" });
    }
  },

  startCall: (ulid) => {
    get().patch(ulid, { work: "calling" });
    get().log(ulid, "call-started", "Call started");
    const l = get().locks[ulid];
    if (l) set((s) => ({ locks: { ...s.locks, [ulid]: { ...l, objective: "call", ttlMins: LOCK_TTL.call, lastTouchAt: now() } } }));
  },

  logCall: (ulid, result, note) => {
    const st = get().states[ulid];
    if (st?.work !== "calling") get().log(ulid, "call-started", "Call started");
    get().log(ulid, "call-result", `Call ${result}${note ? ` · ${note}` : ""}`, { to: result });
    const patch: Partial<MovementState> = { lastOutboundAt: now(), work: "in-work" };
    if (result === "connected") {
      patch.customerWaitingSince = null;
      patch.unread = 0;
      patch.identity = st?.identity === "full" ? "full" : "qualified";
      patch.q = { ...(st?.q ?? {}), responding: true };
    }
    if (result === "wrong-number") {
      get().patch(ulid, patch);
      get().exit(ulid, "unknown", "Wrong number");
      return;
    }
    get().patch(ulid, patch);
    get().touchLock(ulid);
  },

  sendMessage: (ulid, text) => {
    get().patch(ulid, {
      lastOutboundAt: now(), lastGharpayyMsg: text, customerWaitingSince: null, unread: 0, work: "waiting-customer",
    });
    get().log(ulid, "message-sent", `WhatsApp sent: ${text.slice(0, 80)}`);
    get().touchLock(ulid);
  },

  customerReplied: (ulid, text) => {
    const st = get().states[ulid];
    get().patch(ulid, {
      lastCustomerMsgAt: now(),
      lastCustomerMsg: text ?? st?.lastCustomerMsg ?? null,
      customerWaitingSince: st?.customerWaitingSince ?? now(),
      unread: (st?.unread ?? 0) + 1,
      q: { ...(st?.q ?? {}), responding: true },
    });
    get().log(ulid, "customer-replied", text ? `Customer: ${text.slice(0, 80)}` : "Customer replied", {
      actorId: "customer", actorName: "Customer",
    });
  },

  capture: (ulid, q) => {
    const st = get().states[ulid];
    if (!st) return;
    const merged = { ...st.q, ...q };
    const filled = Object.values(merged).filter((v) => v !== null && v !== undefined && v !== "").length;
    const gl = evaluateGoodLead({ ...st, q: merged });
    const wasGood = st.goodLead;
    get().patch(ulid, {
      q: merged,
      identity: filled >= 5 ? "full" : filled >= 2 ? "qualified" : st.identity,
      goodLead: gl.good, goodLeadReasons: gl.reasons,
      checkInDate: merged.moveInDate ?? st.checkInDate ?? null,
      stage: gl.good && st.stage === "new" ? "qualified" : st.stage,
    });
    const keys = Object.keys(q).join(", ");
    get().log(ulid, "qualified", `Captured: ${keys}`, { meta: q as Record<string, unknown> });
    if (gl.good && !wasGood) get().log(ulid, "good-lead", `DEFINITELY CLOSE — system flag (${gl.reasons.join(" · ")})`, { actorId: "system", actorName: "System" });
    get().touchLock(ulid);
  },

  qualify: (ulid, good, checkInDate) => {
    const st = get().states[ulid];
    get().patch(ulid, {
      identity: "full", goodLead: good, stage: good ? "qualified" : st?.stage ?? "new",
      goodLeadReasons: good ? (st?.goodLeadReasons.length ? st.goodLeadReasons : ["operator confirmed"]) : [],
      checkInDate: checkInDate ?? st?.checkInDate ?? null,
    });
    get().log(ulid, "qualified", good ? "Qualified — DEFINITELY CLOSE" : "Qualified — not ready to close");
    if (good) get().log(ulid, "good-lead", "Definitely close flag set", { actorId: "system", actorName: "System" });
  },

  setStage: (ulid, stage, text) => {
    const prev = get().states[ulid]?.stage;
    get().patch(ulid, { stage });
    get().log(ulid, "note", text ?? `Stage ${prev ?? "—"} → ${stage}`, { from: prev, to: stage });
  },

  setWork: (ulid, work) => get().patch(ulid, { work }),

  setNextAction: (ulid, a) => {
    const st = get().states[ulid];
    get().patch(ulid, { nextAction: a, work: st?.currentOperatorId ? "in-work" : "next-action-scheduled" });
    get().log(ulid, "next-action-set",
      `Next action: ${a.kind} @ ${new Date(a.dueAt).toLocaleString()} → ${a.ownerName}${a.note ? ` · ${a.note}` : ""}`);
    get().touchLock(ulid);
  },

  completeNextAction: (ulid) => {
    const st = get().states[ulid];
    get().patch(ulid, { nextAction: null, work: st?.currentOperatorId ? "in-work" : "completed-for-now" });
    get().log(ulid, "next-action-done", `Next action completed (${st?.nextAction?.kind ?? "—"})`);
  },

  shareOptions: (ulid, count) => {
    const st = get().states[ulid];
    get().patch(ulid, {
      stage: st?.stage === "new" || st?.stage === "qualified" ? "matched" : st?.stage ?? "matched",
      q: { ...(st?.q ?? {}), inventoryFit: true },
      lastOutboundAt: now(), lastGharpayyMsg: `${count} verified options shared`,
    });
    get().log(ulid, "matched", `${count} verified PG options shared`);
    get().touchLock(ulid);
  },

  scheduleTour: (ulid, at, property) => {
    get().patch(ulid, { tourAt: at, tourProperty: property ?? null, tourConfirmed: false, stage: "tour-scheduled" });
    get().log(ulid, "tour-scheduled",
      `Tour scheduled ${new Date(at).toLocaleString()}${property ? ` · ${property}` : ""} · Calendly event created`);
    get().handoff(ulid, "tcm");
  },

  confirmTour: (ulid) => {
    const st = get().states[ulid];
    get().patch(ulid, { tourConfirmed: true });
    get().log(ulid, "tour-confirmed", `Tour confirmed — ${st?.tourProperty ?? "property"} · date, time and property locked`);
    get().touchLock(ulid);
  },

  tourDone: (ulid) => {
    get().patch(ulid, { stage: "tour-done", tourDoneAt: now(), tourOutcome: null, tourResult: null, work: "in-work" });
    get().log(ulid, "tour-done", "Tour done — result and outcome are mandatory");
  },

  recordTourResult: (ulid, r) => {
    get().patch(ulid, { tourResult: r });
    get().log(ulid, "tour-result",
      `Tour result: ${r.propertySeen} · ${r.liked ? "liked" : "not liked"}${r.problem ? ` · ${r.problem}` : ""} · ${r.stillLooking ? "still looking" : "decided"} · call ${r.callPicked ? "picked" : "not picked"}`);
  },

  tourOutcome: (ulid, outcome) => {
    get().patch(ulid, { tourOutcome: outcome });
    get().log(ulid, "tour-outcome", `Post-tour outcome: ${outcome}`);
    const a = get().actor;
    if (outcome === "positive") {
      get().setStage(ulid, "quotation", "Closing draft created from positive tour");
      get().handoff(ulid, "closing");
    } else if (outcome === "maybe") {
      get().setNextAction(ulid, {
        kind: "post-tour-call", dueAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
        ownerId: a.id, ownerName: a.name, note: "Follow-up draft — customer undecided",
      });
    } else if (outcome === "property-issue" || outcome === "another-property") {
      get().setStage(ulid, "matched", outcome === "property-issue" ? "Rematch — property issue" : "Matching queue — another property required");
      get().setNextAction(ulid, {
        kind: "send-property", dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
        ownerId: a.id, ownerName: a.name, note: "Send alternatives",
      });
    } else if (outcome === "not-looking") {
      get().exit(ulid, "didnt-like-options", "Not looking after tour");
    }
  },

  prebook: (ulid, step) => {
    const st = get().states[ulid];
    if (!st) return;
    const pb = { ...st.prebook };
    const kind: MovementEventKind =
      step === "eligible" ? "prebook-eligible" : step === "pitched" ? "prebook-pitched"
        : step === "interested" ? "prebook-interested" : "payment-intent";
    if (step === "eligible") pb.eligible = true;
    if (step === "pitched") { pb.eligible = true; pb.pitched = true; }
    if (step === "interested") { pb.eligible = true; pb.pitched = true; pb.interested = true; }
    if (step === "payment-intent") { pb.eligible = true; pb.pitched = true; pb.interested = true; pb.paymentIntent = true; }
    get().patch(ulid, {
      prebook: pb,
      ...(step === "payment-intent" ? { paymentExpected: true, stage: "payment" as FunnelStage } : {}),
      ...(step === "interested" && st.stage !== "payment" ? { stage: "negotiation" as FunnelStage } : {}),
    });
    get().log(ulid, kind, `Pre-book ${step.replace("-", " ")}`);
    if (step === "payment-intent" && st.handoffTo !== "closing") get().handoff(ulid, "closing");
    get().touchLock(ulid);
  },

  sendQuote: (ulid) => {
    const st = get().states[ulid];
    get().patch(ulid, { stage: st?.stage === "payment" ? "payment" : "quotation", lastOutboundAt: now(), lastGharpayyMsg: "Quotation sent" });
    get().log(ulid, "quote-sent", "Quotation sent");
    get().touchLock(ulid);
  },

  setBlocker: (ulid, b) => {
    const st = get().states[ulid];
    get().patch(ulid, { blocker: b, stage: st?.stage === "payment" ? "payment" : "negotiation" });
    get().log(ulid, "negotiation", b === "none" ? "Blocker cleared" : `Blocker: ${b}`);
    get().touchLock(ulid);
  },

  collectPayment: (ulid, amount) => {
    const st = get().states[ulid];
    get().patch(ulid, {
      stage: "payment", paymentExpected: false, paidAmount: amount,
      prebook: { ...(st?.prebook ?? blank({ ulid }).prebook), paid: true },
    });
    get().log(ulid, "payment-received", `Payment received${amount ? ` ₹${amount.toLocaleString("en-IN")}` : ""}`);
    get().touchLock(ulid);
  },

  book: (ulid) => {
    get().patch(ulid, {
      stage: "booked", nextAction: null, customerWaitingSince: null, unread: 0, blocker: "none", paymentExpected: false,
    });
    get().log(ulid, "booked", "BOOKED");
    get().handoff(ulid, "ops");
  },

  checkIn: (ulid) => {
    get().patch(ulid, { stage: "check-in", checkedInAt: now(), work: "completed-for-now", handoffTo: null });
    get().log(ulid, "checked-in", "Checked in — journey complete");
  },

  exit: (ulid, reason, note) => {
    get().patch(ulid, {
      stage: "lost", lossReason: reason, work: "completed-for-now", nextAction: null,
      customerWaitingSince: null, unread: 0, handoffTo: null,
    });
    get().log(ulid, "exit", `Exit — ${reason}${note ? ` · ${note}` : ""}`);
  },

  handoff: (ulid, to) => {
    const owner = TEAM_OWNER[to];
    const st = get().states[ulid];
    get().patch(ulid, {
      handoffTo: to, handoffAt: now(), handoffAckAt: null,
      work: st?.currentOperatorId ? "in-work" : "handoff-pending",
      nextAction: {
        kind: nextActionKindForTeam[to],
        dueAt: new Date(Date.now() + (to === "tcm" ? 5 : to === "closing" ? 15 : 60) * 60000).toISOString(),
        ownerId: owner.id, ownerName: owner.name, note: `Handoff from ${get().actor.name}`,
      },
    });
    get().log(ulid, "handoff", `Handed off to ${to.toUpperCase()} → ${owner.name} · ack SLA ${to === "tcm" ? 5 : to === "closing" ? 15 : 60}m`);
  },

  ackHandoff: (ulid) => {
    const a = get().actor;
    const st = get().states[ulid];
    const mins = st?.handoffAt ? Math.round((Date.now() - +new Date(st.handoffAt)) / 60000) : 0;
    get().patch(ulid, { handoffAckAt: now(), work: st?.currentOperatorId ? "in-work" : "next-action-scheduled" });
    get().log(ulid, "handoff-ack", `Handoff acknowledged by ${a.name} after ${mins}m`);
  },

  transferPrimary: (ulid, op) => {
    const st = get().states[ulid];
    get().patch(ulid, { primaryOwnerId: op.id, primaryOwnerName: op.name });
    get().log(ulid, "note", `Primary owner ${st?.primaryOwnerName ?? "—"} → ${op.name}`, { from: st?.primaryOwnerName, to: op.name });
  },

  addUnmatched: (u) =>
    set((s) => ({ unmatched: [{ ...u, id: uid("um"), ts: now(), retries: 0 }, ...s.unmatched] })),

  retryUnmatched: (id) =>
    set((s) => ({ unmatched: s.unmatched.map((u) => (u.id === id ? { ...u, retries: u.retries + 1 } : u)) })),

  resolveUnmatched: (id) => set((s) => ({ unmatched: s.unmatched.filter((u) => u.id !== id) })),

  snapshot: (c) => {
    set((s) => ({ checkpoints: [{ ...c, id: uid("cp"), at: now() }, ...s.checkpoints].slice(0, 60) }));
    get().log("checkpoint", "checkpoint", `${c.label} checkpoint · ${c.status} · main leak ${c.mainLeak}`, { actorId: "system", actorName: "System" });
  },

  reset: () => set({ ...initialState(), actor: get().actor }),
});

export const useMovement = create<MovementStore>()(
  persist(movementCreator, { name: "gharpayy.movement.v2", version: 2 }),
);

/** Fresh, non-persisted store — used by the audit runner so it never pollutes real work. */
export const createIsolatedStore = () => create<MovementStore>()(movementCreator);
