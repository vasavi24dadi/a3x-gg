// Gharpayy Booking Flow — WhatsApp screenshot → CRM → daily batches → qualification.
// One shared model for both Guided mode and Expert mode.

export type Mode = "GUIDED" | "EXPERT";

export type RowStatus = "NEW" | "ADDED" | "MERGED" | "IGNORED";

export interface CapturedRow {
  id: string;
  screenshot: string;
  name: string;
  phone: string;
  lastMessage: string;
  time: string;
  unread: number;
  labels: string[];
  outgoing?: boolean;
  status: RowStatus;
  /** set when this row merged into an existing customer */
  leadId?: string;
}

export interface FlowEvent {
  at: string;
  actor: string;
  label: string;
  detail?: string;
  /** which journey step this touched — used to show per-question history */
  stepKey?: string;
  /** exactly what changed, so an edit can always be traced */
  changes?: { field: string; from: string; to: string }[];
}

export type Ack = "CAN_CLOSE" | "NEED_HELP" | "NOT_REAL";
export type Temp = "HOT" | "COLD";

export interface Qualification {
  when?: string;
  onWhatsapp?: string;
  channel?: string;
  area?: string;
  moveIn?: string;
  budget?: string;
  roomType?: string;
  ack?: Ack;
  blocker?: string;
}

export interface FlowLead {
  id: string;
  /** Shared identity used by Draft Vision, Movement, Admin and Booking Flow. */
  canonicalId?: string;
  /** Present only when this local projection maps to one unique hosted leads.id. */
  hostedLeadId?: string;
  hostedNextActionId?: string | null;
  hostedClaimId?: string | null;
  hostedClaimError?: string | null;
  name: string;
  phone: string;
  waAccount: string;
  lastMessage: string;
  /** last customer/team activity on the chat */
  lastActivityAt: string;
  unread: number;
  labels: string[];
  /** every answer given on the journey, keyed by journey field */
  f: Record<string, string>;
  /** when somebody actually said "I own this lead" */
  ownedAt?: string;
  /** last time the operator did something */
  lastActionAt?: string;
  /** screenshot heartbeat — last fresh evidence for this chat */
  lastEvidenceAt?: string;
  /** batch assignment */
  handler?: string;
  round?: number;
  batchId?: string;
  owner?: string;
  stage: string;
  q: Qualification;
  temp?: Temp;
  tempReason?: string;
  nextAction?: string;
  nextActionAt?: string;
  qualifiedAt?: string;
  escalated?: boolean;
  closedReason?: string;
  /** other leads that are the same person or the same group requirement */
  connectedTo?: string[];
  events: FlowEvent[];
}

export interface Batch {
  id: string;
  handler: string;
  round: number;
  createdAt: string;
  leadIds: string[];
  /** a draft (D1–D4) is closed only when the handler signs it off */
  closedAt?: string;
  closeNote?: string;
}

export const HANDLERS = ["Riya", "Aman", "Sneha", "Vikas", "Pooja", "Kunal", "Neha", "Rahul"];
export const ROUNDS = [1, 2, 3, 4];
export const BATCH_SIZE = 30;

export interface StepDef {
  key: keyof Qualification;
  goal: string;
  question: string;
  help: string;
  kind: "CHOICE" | "TEXT" | "DATE";
  options?: { value: string; label: string; hint?: string }[];
  placeholder?: string;
}

export const STEPS: StepDef[] = [
  {
    key: "when",
    goal: "Decide the timing",
    question: "When do we handle this customer?",
    help: "This sets the deadline. A lead with no timing cannot move ahead.",
    kind: "CHOICE",
    options: [
      { value: "NOW", label: "Right now", hint: "Reply or call within 15 minutes" },
      { value: "TODAY", label: "Today", hint: "Before the day ends" },
      { value: "WEEK", label: "This week", hint: "Within 7 days" },
      { value: "FUTURE", label: "Future", hint: "Move-in is far away" },
    ],
  },
  {
    key: "onWhatsapp",
    goal: "Check the chat",
    question: "Is this customer already on WhatsApp with us?",
    help: "Tells us whether we continue an old chat or start a fresh one.",
    kind: "CHOICE",
    options: [
      { value: "EXISTING", label: "Yes — chat already exists", hint: "Continue the same thread" },
      { value: "OLD", label: "Yes, but the chat is old", hint: "Reopen with a fresh message" },
      { value: "NONE", label: "No — first contact needed", hint: "Send the first message" },
      { value: "NOT_ON_WA", label: "Not on WhatsApp", hint: "Call only" },
    ],
  },
  {
    key: "channel",
    goal: "Fix the channel",
    question: "How are we going to talk to them?",
    help: "Every lead needs one clear channel so nobody guesses.",
    kind: "CHOICE",
    options: [
      { value: "WHATSAPP", label: "WhatsApp" },
      { value: "CALL", label: "Call" },
      { value: "BOTH", label: "Both" },
    ],
  },
  {
    key: "area",
    goal: "Where do they want to stay",
    question: "Which area or landmark?",
    help: "Office, college or locality — whatever they said in the chat.",
    kind: "TEXT",
    placeholder: "Kharadi / Hinjewadi / near Symbiosis…",
  },
  {
    key: "moveIn",
    goal: "Move-in date",
    question: "When do they want to move in?",
    help: "Move-in date decides how hot the lead is.",
    kind: "DATE",
  },
  {
    key: "budget",
    goal: "Budget",
    question: "What is their monthly budget?",
    help: "A number is enough — we refine it on the call.",
    kind: "TEXT",
    placeholder: "12000",
  },
  {
    key: "roomType",
    goal: "Room type",
    question: "What kind of room do they want?",
    help: "Match this against live inventory later.",
    kind: "CHOICE",
    options: [
      { value: "SINGLE", label: "Single" },
      { value: "DOUBLE", label: "Double sharing" },
      { value: "TRIPLE", label: "Triple sharing" },
      { value: "ANY", label: "Open to any" },
    ],
  },
  {
    key: "ack",
    goal: "Your honest call",
    question: "Can you close this customer?",
    help: "Say it plainly. Nobody should waste a customer's time.",
    kind: "CHOICE",
    options: [
      { value: "CAN_CLOSE", label: "I can close this", hint: "Goes ahead to matching and tour" },
      { value: "NEED_HELP", label: "Not sure — I need help", hint: "Goes to Control Tower with your blocker" },
      { value: "NOT_REAL", label: "This is not a real lead", hint: "Closes with a reason" },
    ],
  },
];

export const NEXT_ACTIONS = [
  "Send WhatsApp message",
  "Call the customer",
  "Share property options",
  "Schedule the tour",
  "Send quotation",
  "Follow up on decision",
];
