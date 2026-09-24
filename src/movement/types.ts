// Gharpayy Customer Movement OS — one journey, six truths, append-only events.

export type DraftCode = "D1" | "D2" | "D3" | "D4";

export const DRAFT_META: Record<DraftCode, { label: string; hint: string }> = {
  D1: { label: "D1 · Immediate", hint: "Ready now — tour / payment intent" },
  D2: { label: "D2 · Active", hint: "Talking, needs a push" },
  D3: { label: "D3 · Future", hint: "Real, but later" },
  D4: { label: "D4 · Cold", hint: "No response / not looking" },
};

export type FunnelStage =
  | "new" | "qualified" | "matched" | "tour-scheduled" | "tour-done"
  | "quotation" | "negotiation" | "payment" | "booked" | "check-in" | "lost";

export const FUNNEL_ORDER: FunnelStage[] = [
  "new", "qualified", "matched", "tour-scheduled", "tour-done",
  "quotation", "negotiation", "payment", "booked", "check-in", "lost",
];

export const STAGE_LABEL: Record<FunnelStage, string> = {
  new: "New", qualified: "Qualified", matched: "Matched", "tour-scheduled": "Tour Scheduled",
  "tour-done": "Tour Done", quotation: "Quotation", negotiation: "Negotiation", payment: "Payment",
  booked: "Booked", "check-in": "Checked In", lost: "Lost",
};

export type WorkState =
  | "available" | "drafting" | "in-work" | "calling" | "waiting-customer"
  | "next-action-scheduled" | "handoff-pending" | "completed-for-now";

export type NextActionKind =
  | "call" | "whatsapp" | "send-property" | "confirm-tour"
  | "post-tour-call" | "send-quote" | "collect-payment" | "recheck-later";

export const NEXT_ACTION_LABEL: Record<NextActionKind, string> = {
  call: "Call", whatsapp: "WhatsApp", "send-property": "Send Property", "confirm-tour": "Confirm Tour",
  "post-tour-call": "Post-Tour Call", "send-quote": "Send Quote", "collect-payment": "Collect Payment",
  "recheck-later": "Recheck Later",
};

export type Health = "healthy" | "due-soon" | "action-due" | "at-risk" | "breached" | "stuck";

export type PriorityBucket = "P0" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";

export const PRIORITY_LABEL: Record<PriorityBucket, string> = {
  P0: "CUSTOMER WAITING",
  P1: "REVENUE NOW",
  P2: "TOUR NOW",
  P3: "FOLLOW-UP DUE",
  P4: "HIGH INTENT",
  P5: "FRESH",
  P6: "RECOVERY",
};

export type IdentityLevel = "shadow" | "qualified" | "full";

export type CallResult = "connected" | "no-answer" | "busy" | "wrong-number" | "rejected";

export type Blocker =
  | "price" | "property" | "parent-approval" | "room-availability"
  | "deposit" | "move-in-date" | "payment-timing" | "trust" | "none";

export type LossReason =
  | "future-date" | "budget" | "no-inventory" | "no-response"
  | "didnt-like-options" | "not-pitched" | "unknown";

export type TourOutcome = "positive" | "maybe" | "property-issue" | "not-looking" | "another-property";

export type Team = "flow-ops" | "tcm" | "closing" | "ops";

export type LockObjective = "drafting" | "call" | "whatsapp" | "tour" | "closing" | "work";

/** Action-aware lock TTLs (minutes of inactivity). */
export const LOCK_TTL: Record<LockObjective, number> = {
  drafting: 1, call: 10, whatsapp: 7, tour: 15, closing: 12, work: 10,
};

export interface Operator {
  id: string;
  name: string;
  role: Team;
  zone: string;
}

export const OPERATORS: Operator[] = [
  { id: "u-self", name: "You", role: "flow-ops", zone: "KORA CORE" },
  { id: "op-nandini", name: "Nandini", role: "flow-ops", zone: "KORA CORE" },
  { id: "op-avani", name: "Avani", role: "flow-ops", zone: "EAST" },
  { id: "op-rohan", name: "Rohan (TCM)", role: "tcm", zone: "KORA CORE" },
  { id: "op-meera", name: "Meera (Closing)", role: "closing", zone: "KORA CORE" },
];

export const ZONE_PRIORITY: Record<string, number> = {
  KOR: 30, HSR: 25, BTM: 20, IDR: 20, WFD: 15, MRT: 15, BLD: 15, ECT: 10, JPN: 10, KLN: 8, HBL: 8, SJR: 12,
};

export interface NextAction {
  kind: NextActionKind;
  dueAt: string;
  ownerId: string;
  ownerName: string;
  note?: string;
}

export interface LiveLock {
  ulid: string;
  hostedClaimId?: string;
  operatorId: string;
  operatorName: string;
  startedAt: string;
  objective: LockObjective;
  objectiveText: string;
  ttlMins: number;
  lastTouchAt: string;
}

/** Progressive qualification — nothing mandatory at once. */
export interface Qualification {
  moveInDate?: string | null;
  location?: string | null;
  officeOrCollege?: string | null;
  budget?: number | null;
  roomType?: string | null;
  currentLocation?: string | null;
  forSelf?: boolean | null;
  inBangalore?: boolean | null;
  priceIntent?: "ok" | "stretch" | "no" | null;
  feasible?: boolean | null;
  inventoryFit?: boolean | null;
  responding?: boolean | null;
}

export interface TourResult {
  propertySeen: string;
  liked: boolean;
  problem?: string;
  stillLooking: boolean;
  callPicked: boolean;
}

export interface PrebookPipeline {
  eligible: boolean;
  pitched: boolean;
  interested: boolean;
  paymentIntent: boolean;
  paid: boolean;
}

export interface MovementState {
  ulid: string;
  /** Stable customer key shared by every operating surface. */
  canonicalId: string;
  /** Present only when this local projection maps to one hosted leads.id. */
  hostedLeadId?: string;
  /** The hosted next_actions row currently represented by nextAction. */
  hostedNextActionId?: string | null;
  name?: string;
  phone?: string;
  waAccount: string;
  zone: string;
  identity: IdentityLevel;

  /** A. DRAFT — WhatsApp side (signal) vs CRM side (record) */
  waDraft: DraftCode | null;
  crmDraft: DraftCode | null;
  draftedAt?: string;
  draftedById?: string;
  draftedByName?: string;
  batchId?: string;
  batchPosition?: string;

  /** B. FUNNEL */
  stage: FunnelStage;
  /** C. WORK */
  work: WorkState;

  /** D. OWNERSHIP */
  primaryOwnerId: string;
  primaryOwnerName: string;
  currentOperatorId?: string | null;
  currentOperatorName?: string | null;

  /** E. NEXT ACTION */
  nextAction: NextAction | null;

  /** Signals */
  customerWaitingSince?: string | null;
  unread: number;
  lastCustomerMsgAt?: string | null;
  lastCustomerMsg?: string | null;
  lastOutboundAt?: string | null;
  lastGharpayyMsg?: string | null;
  createdAt: string;

  q: Qualification;
  goodLead: boolean;
  goodLeadReasons: string[];
  checkInDate?: string | null;

  tourAt?: string | null;
  tourProperty?: string | null;
  tourConfirmed?: boolean;
  tourDoneAt?: string | null;
  tourOutcome?: TourOutcome | null;
  tourResult?: TourResult | null;

  prebook: PrebookPipeline;
  blocker?: Blocker;
  lossReason?: LossReason | null;
  paymentExpected?: boolean;
  paidAmount?: number;
  checkedInAt?: string | null;

  handoffTo?: Team | null;
  handoffAt?: string | null;
  handoffAckAt?: string | null;

  conflicts: number;
  updatedAt: string;
}

export type MovementEventKind =
  | "ingested" | "matched-existing" | "drafted" | "draft-synced" | "wa-draft" | "claimed" | "released" | "conflict"
  | "call-started" | "call-result" | "message-sent" | "customer-replied"
  | "qualified" | "good-lead" | "matched"
  | "tour-scheduled" | "tour-confirmed" | "tour-done" | "tour-result" | "tour-outcome"
  | "prebook-eligible" | "prebook-pitched" | "prebook-interested" | "payment-intent"
  | "quote-sent" | "negotiation" | "payment-received" | "booked" | "checked-in"
  | "next-action-set" | "next-action-done" | "handoff" | "handoff-ack"
  | "exit" | "note" | "batch-started" | "batch-ended" | "checkpoint" | "hosted-history";

export interface MovementEvent {
  id: string;
  ts: string;
  ulid: string;
  kind: MovementEventKind;
  actorId: string;
  actorName: string;
  text: string;
  from?: string;
  to?: string;
  batchId?: string;
  position?: string;
  meta?: Record<string, unknown>;
}

export type BatchLabel = "G1" | "G2" | "G3" | "G4" | "CLOSURE";

export const BATCH_META: Record<BatchLabel, { title: string; mix: string }> = {
  G1: { title: "G1 · Morning", mix: "Overnight + yesterday + immediate" },
  G2: { title: "G2 · Late morning", mix: "Fresh + tour creation" },
  G3: { title: "G3 · Afternoon", mix: "Follow-up + immediate + tour confirmation" },
  G4: { title: "G4 · Evening", mix: "Post-tour + quote + closing" },
  CLOSURE: { title: "Closure draft", mix: "Existing commitments only — no fresh" },
};

export interface DraftBatch {
  id: string;
  label: BatchLabel;
  size: number;
  ulids: string[];
  startedAt: string;
  endedAt?: string;
  operatorId: string;
  operatorName: string;
  cursor: number;
  /** ms spent per lead, for speed metrics */
  perLeadMs: number[];
}

export interface UnmatchedChat {
  id: string;
  phoneRaw: string;
  waAccount: string;
  name?: string;
  lastMessage?: string;
  reason: string;
  ts: string;
  retries: number;
}

export type CheckpointLabel = "1PM" | "5PM" | "EOD";

export interface Checkpoint {
  id: string;
  at: string;
  label: CheckpointLabel;
  operatorId: string;
  totals: Record<string, number>;
  status: "ON TRACK" | "BEHIND" | "PASS" | "FAIL";
  mainLeak: string;
  required: Record<string, number>;
  inference: string;
}

export interface ConflictLog {
  id: string;
  ts: string;
  ulid: string;
  byId: string;
  byName: string;
  holderName: string;
  waAccount: string;
}

export const DAILY_TARGET = {
  drafted: 120, worked: 90, calls: 100, connected: 70, good: 30,
  tours: 12, toursDone: 8, quotes: 6, bookings: 3,
};

export const CHECKPOINT_TARGET: Record<CheckpointLabel, Partial<typeof DAILY_TARGET>> = {
  "1PM": { drafted: 30, connected: 18, good: 8, tours: 3 },
  "5PM": { drafted: 78, connected: 44, good: 20, tours: 7 },
  EOD: DAILY_TARGET,
};

export const CAPACITY_CAP = 25;
