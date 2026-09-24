// One store for both modes. Every write appends to the lead's timeline.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BATCH_SIZE, HANDLERS, ROUNDS } from "./types";
import type { Batch, CapturedRow, FlowLead, Mode, Qualification, Temp } from "./types";
import { seedCapturedRows, seedLeads } from "./seed";
import { JOURNEY, currentStep } from "./journey";
import { canonicalCustomerId, phoneKey } from "@/lib/canonical/customer-id";
import {
  claimFlowLead,
  flowEventFromLocal,
  heartbeatFlowClaim,
  persistFlowLead,
  persistFlowNextAction,
  releaseFlowClaim,
  stagePatch,
  type HostedFlowMatch,
} from "./hosted";

const now = () => new Date().toISOString();
const DAY = 86_400_000;

export const daysOld = (isoDate: string) => Math.floor((Date.now() - +new Date(isoDate)) / DAY);

export function autoTemp(l: FlowLead): Temp {
  if (l.tempReason && l.temp) return l.temp;
  const moveIn = l.f?.moveIn ?? l.q.moveIn;
  const when = l.f?.when ?? l.q.when;
  const soon = moveIn ? +new Date(moveIn) - Date.now() < 20 * DAY : false;
  if (when === "NOW" || when === "TODAY" || soon) return "HOT";
  if (daysOld(l.lastActivityAt) >= 5 || when === "FUTURE") return "COLD";
  return "HOT";
}

interface State {
  mode: Mode;
  me: string;
  round: number;
  rows: CapturedRow[];
  leads: FlowLead[];
  batches: Batch[];

  setMode: (m: Mode) => void;
  setMe: (name: string) => void;
  setRound: (r: number) => void;

  /** bring a customer from another view (Movement OS etc.) into the booking flow */
  ensureLead: (input: { name: string; phone: string; lastMessage?: string; source?: string }) => string;
  hydrateHosted: (matches: HostedFlowMatch[]) => void;

  // capture
  addRow: (rowId: string) => void;
  mergeRow: (rowId: string) => void;
  ignoreRow: (rowId: string) => void;
  addAllNew: () => number;
  resetCapture: () => void;

  // batches
  buildBatch: (handler: string, round: number) => Batch | undefined;
  buildAllRounds: () => number;
  closeBatch: (batchId: string, note: string) => void;
  reopenBatch: (batchId: string) => void;
  stuckCount: () => number;

  // qualification (legacy short flow, kept for compatibility)
  answer: (leadId: string, key: keyof Qualification, value: string) => void;
  finishQualification: (leadId: string, nextAction: string, nextActionAt: string) => void;

  // the journey
  answerStep: (leadId: string, stepKey: string, values: Record<string, string>) => void;
  setNext: (leadId: string, nextAction: string, nextActionAt: string) => void;
  logActivity: (leadId: string, activity: string, note?: string) => void;
  editFields: (leadId: string, values: Record<string, string>, reason: string, stepKey?: string) => void;
  claim: (leadId: string) => void;
  toggleLabel: (leadId: string, label: string) => void;

  // expert powers
  setTemp: (leadId: string, temp: Temp, reason: string) => void;
  reassign: (leadId: string, handler: string) => void;
  moveStage: (leadId: string, stage: string, reason: string) => void;
  bulk: (leadIds: string[], patch: { handler?: string; nextAction?: string; nextActionAt?: string; temp?: Temp; escalate?: boolean }, reason: string) => void;
  escalate: (leadId: string, reason: string) => void;
  reset: () => void;
}

const ev = (actor: string, label: string, detail?: string) => ({ at: now(), actor, label, detail });

export const useBookingFlow = create<State>()(
  persist(
    (set, get) => {
      const syncHosted = (leadId: string, activity: string, detail?: string, patch?: Record<string, unknown>) => {
        const lead = get().leads.find((item) => item.id === leadId);
        if (!lead?.hostedLeadId) return;
        const event = flowEventFromLocal({ at: now(), actor: get().me, label: activity, detail });
        void persistFlowLead({ lead, event: { ...event, activity, detail }, patch })
          .catch((error) => console.warn("Booking Flow hosted state not synced", error));
      };

      const syncNext = (leadId: string) => {
        const lead = get().leads.find((item) => item.id === leadId);
        if (!lead?.hostedLeadId) return;
        void persistFlowNextAction(lead, lead.nextAction ?? null, lead.nextActionAt ?? null)
          .then((id) => {
            if (id && get().leads.find((item) => item.id === leadId)?.hostedNextActionId !== id) {
              set((s) => ({ leads: s.leads.map((item) => item.id === leadId ? { ...item, hostedNextActionId: id } : item) }));
            }
          })
          .catch((error) => console.warn("Booking Flow next action not synced", error));
      };

      const syncClaimHeartbeat = (leadId: string) => {
        const claimId = get().leads.find((item) => item.id === leadId)?.hostedClaimId;
        if (claimId) void heartbeatFlowClaim(claimId).catch((error) => console.warn("Booking Flow claim heartbeat failed", error));
      };

      const releaseHosted = (leadId: string, reason: string) => {
        const claimId = get().leads.find((item) => item.id === leadId)?.hostedClaimId;
        if (!claimId) return;
        void releaseFlowClaim(claimId, reason)
          .then(() => set((s) => ({ leads: s.leads.map((item) => item.id === leadId ? { ...item, hostedClaimId: null } : item) })))
          .catch((error) => console.warn("Booking Flow claim release failed", error));
      };

      return ({
      mode: "GUIDED",
      me: HANDLERS[0],
      round: 1,
      rows: seedCapturedRows(),
      leads: seedLeads(),
      batches: [],

      setMode: (mode) => set({ mode }),
      setMe: (me) => set({ me }),
      setRound: (round) => set({ round }),

      hydrateHosted: (matches) => {
        if (!matches.length) return;
        set((s) => ({
          leads: s.leads.map((lead) => {
            const match = matches.find((item) => item.localId === lead.id);
            if (!match) return lead;
            return {
              ...lead,
              hostedLeadId: match.hostedLeadId,
              hostedNextActionId: match.hostedNextActionId,
              owner: match.owner ?? lead.owner,
              handler: match.owner ?? lead.handler,
              nextAction: match.nextAction ?? lead.nextAction,
              nextActionAt: match.nextActionAt ?? lead.nextActionAt,
              lastMessage: match.lastMessage ?? lead.lastMessage,
              q: match.moveInDate ? { ...lead.q, moveIn: lead.q.moveIn ?? match.moveInDate } : lead.q,
            };
          }),
        }));
      },

      ensureLead: ({ name, phone, lastMessage, source }) => {
        const s = get();
        const phoneIdentity = phoneKey(phone);
        if (!phoneIdentity) return "";
        const canonicalId = canonicalCustomerId({ phone, name });
        const found = s.leads.find((lead) =>
          phoneKey(lead.phone) === phoneIdentity,
        );
        if (found) {
          if (!found.canonicalId) set({ leads: s.leads.map((lead) => lead.id === found.id ? { ...lead, canonicalId } : lead) });
          return found.id;
        }
        if (!canonicalId) return "";
        const lead: FlowLead = {
          id: canonicalId,
          canonicalId,
          name: name || phone,
          phone,
          waAccount: "Gharpayy Sales 01",
          lastMessage: lastMessage || "Opened from " + (source || "another view"),
          lastActivityAt: now(),
          unread: 0,
          labels: [],
          stage: "WHERE",
          q: {},
          f: {},
          lastEvidenceAt: now(),
          events: [ev("System", `Opened in Booking Flow from ${source || "another view"}`)],
        };
        set({ leads: [lead, ...s.leads] });
        return lead.id;
      },

      addRow: (rowId) =>
        set((s) => {
          const row = s.rows.find((r) => r.id === rowId);
          if (!row || row.status !== "NEW") return s;
          const lead: FlowLead = {
            id: canonicalCustomerId({ phone: row.phone, name: row.name }) || `bf-new-${row.id}`,
            canonicalId: canonicalCustomerId({ phone: row.phone, name: row.name }) || undefined,
            name: row.name,
            phone: row.phone,
            waAccount: "Gharpayy Sales 01",
            lastMessage: row.lastMessage,
            lastActivityAt: now(),
            unread: row.unread,
            labels: row.labels,
            stage: "WHERE",
            q: {},
            f: { captured: "YES" },
            lastEvidenceAt: now(),
            events: [ev("Draft Vision", "Added to CRM from screenshot", row.screenshot)],
          };
          return {
            leads: [lead, ...s.leads],
            rows: s.rows.map((r) => (r.id === rowId ? { ...r, status: "ADDED", leadId: lead.id } : r)),
          };
        }),

      mergeRow: (rowId) =>
        set((s) => {
          const row = s.rows.find((r) => r.id === rowId);
          if (!row) return s;
          const rowPhone = phoneKey(row.phone);
          if (!rowPhone) return s;
          const matches = s.leads.filter((l) => phoneKey(l.phone) === rowPhone);
          const match = matches.length === 1 ? matches[0] : undefined;
          if (!match) return s;
          return {
            rows: s.rows.map((r) => (r.id === rowId ? { ...r, status: "MERGED", leadId: match.id } : r)),
            leads: s.leads.map((l) =>
              l.id === match.id
                ? {
                    ...l,
                    lastMessage: row.lastMessage,
                    lastActivityAt: now(),
                    events: [...l.events, ev("Draft Vision", "New messages merged into existing customer", row.screenshot)],
                  }
                : l,
            ),
          };
        }),

      ignoreRow: (rowId) => set((s) => ({ rows: s.rows.map((r) => (r.id === rowId ? { ...r, status: "IGNORED" } : r)) })),

      addAllNew: () => {
        const ids = get().rows.filter((r) => r.status === "NEW").map((r) => r.id);
        ids.forEach((id) => get().addRow(id));
        return ids.length;
      },

      resetCapture: () => set({ rows: seedCapturedRows() }),

      buildBatch: (handler, round) => {
        const s = get();
        const existing = s.batches.find((b) => b.handler === handler && b.round === round);
        if (existing) return existing;
        const pool = s.leads
          .filter((l) => !l.batchId && !l.qualifiedAt && daysOld(l.lastActivityAt) <= 7)
          .sort((a, b) => +new Date(a.lastActivityAt) - +new Date(b.lastActivityAt))
          .slice(0, BATCH_SIZE);
        if (pool.length === 0) return undefined;
        const batch: Batch = {
          id: `batch-${handler}-${round}`,
          handler,
          round,
          createdAt: now(),
          leadIds: pool.map((l) => l.id),
        };
        const ids = new Set(batch.leadIds);
        set({
          batches: [...s.batches, batch],
          leads: s.leads.map((l) =>
            ids.has(l.id)
              ? { ...l, batchId: batch.id, handler, round, owner: handler, events: [...l.events, ev("System", `Given to ${handler} — round ${round}`)] }
              : l,
          ),
        });
          for (const id of batch.leadIds) {
            const assigned = get().leads.find((lead) => lead.id === id);
            if (assigned?.hostedLeadId) {
              syncHosted(id, "batch_assigned", `Given to ${handler} · round ${round}`, { current_handler_name: handler });
            }
          }
        return batch;
      },

      buildAllRounds: () => {
        let made = 0;
        ROUNDS.forEach((round) => {
          HANDLERS.forEach((h) => {
            const before = get().batches.length;
            get().buildBatch(h, round);
            if (get().batches.length > before) made += 1;
          });
        });
        return made;
      },

      closeBatch: (batchId, note) =>
        set((s) => {
          const batch = s.batches.find((b) => b.id === batchId);
          if (!batch) return s;
          const ids = new Set(batch.leadIds);
          return {
            batches: s.batches.map((b) => (b.id === batchId ? { ...b, closedAt: now(), closeNote: note } : b)),
            leads: s.leads.map((l) =>
              ids.has(l.id)
                ? { ...l, events: [...l.events, ev(s.me, `Draft D${batch.round} closed`, note || undefined)] }
                : l,
            ),
          };
        }),

      reopenBatch: (batchId) =>
        set((s) => ({
          batches: s.batches.map((b) => (b.id === batchId ? { ...b, closedAt: undefined, closeNote: undefined } : b)),
        })),

      stuckCount: () => get().leads.filter((l) => !l.qualifiedAt && daysOld(l.lastActivityAt) > 7).length,

      answer: (leadId, key, value) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? { ...l, q: { ...l.q, [key]: value }, events: [...l.events, ev(s.me, `${key} answered`, value)] }
              : l,
          ),
        })),

      finishQualification: (leadId, nextAction, nextActionAt) =>
        set((s) => ({
          leads: s.leads.map((l) => {
            if (l.id !== leadId) return l;
            const ack = l.q.ack;
            const stage = ack === "NOT_REAL" ? "CLOSED" : ack === "NEED_HELP" ? "CONTROL_TOWER" : "QUALIFIED";
            return {
              ...l,
              owner: l.owner ?? s.me,
              stage,
              nextAction,
              nextActionAt,
              qualifiedAt: now(),
              escalated: ack === "NEED_HELP",
              closedReason: ack === "NOT_REAL" ? l.q.blocker || "Not a real lead" : undefined,
              temp: l.tempReason ? l.temp : autoTemp({ ...l }),
              events: [
                ...l.events,
                ev(s.me, `Qualification finished — ${stage.toLowerCase().replace("_", " ")}`, `${nextAction} by ${new Date(nextActionAt).toLocaleString()}`),
              ],
            };
          }),
        })),

      answerStep: (leadId, stepKey, values) => {
        set((s) => {
          const step = JOURNEY.find((j) => j.key === stepKey);
          if (!step) return s;
          const chosen = values[step.field];
          const opt = step.options?.find((o) => o.value === chosen);
          return {
            leads: s.leads.map((l) => {
              if (l.id !== leadId) return l;
              const f = { ...l.f, ...values };
              const next = currentStep(f);
              const escalate = opt?.effect === "ESCALATE";
              const close = opt?.effect === "CLOSE";
              const owner = stepKey === "OWN" && chosen === "OWN" ? s.me : l.owner;
              return {
                ...l,
                f,
                owner,
                handler: owner ?? l.handler,
                ownedAt: stepKey === "OWN" && chosen === "OWN" ? now() : l.ownedAt,
                stage: close ? "CLOSED" : next ? next.key : "SETTLED",
                escalated: escalate ? true : l.escalated,
                closedReason: close ? (values["ownershipNote"] || opt?.label || "Closed") : l.closedReason,
                lastActionAt: now(),
                qualifiedAt: stepKey === "INTENT" ? now() : l.qualifiedAt,
                temp: l.tempReason ? l.temp : autoTemp({ ...l, f }),
                events: [
                  ...l.events,
                  {
                    ...ev(s.me, step.title, opt ? opt.label : Object.values(values).filter(Boolean).join(" · ")),
                    stepKey,
                    changes: Object.entries(values).map(([field, to]) => ({ field, from: l.f?.[field] ?? "", to })),
                  },
                  ...(escalate ? [ev(s.me, "Sent to Control Tower", values["ownershipNote"] || opt?.label)] : []),
                  ...(close ? [ev(s.me, "Journey closed", opt?.label)] : []),
                ],
              };
            }),
          };
        });
        const lead = get().leads.find((item) => item.id === leadId);
        const stage = stagePatch(stepKey);
        syncHosted(leadId, `step_${stepKey.toLowerCase()}`, Object.values(values).filter(Boolean).join(" · "), stage ? { current_pipeline_stage: stage, current_mission: lead?.nextAction ?? null } : undefined);
        syncNext(leadId);
        const selected = JOURNEY.find((item) => item.key === stepKey)?.options?.find((item) => item.value === values[JOURNEY.find((item) => item.key === stepKey)?.field ?? ""]);
        if (selected?.effect === "CLOSE") releaseHosted(leadId, "journey_closed");
      },

      setNext: (leadId, nextAction, nextActionAt) => {
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? {
                  ...l,
                  nextAction,
                  nextActionAt,
                  lastActionAt: now(),
                  events: [...l.events, ev(s.me, "Next step locked", `${nextAction} by ${new Date(nextActionAt).toLocaleString()}`)],
                }
              : l,
          ),
        }));
        syncNext(leadId);
        syncHosted(leadId, "next_action_locked", `${nextAction} by ${new Date(nextActionAt).toLocaleString()}`, {
          current_mission: nextAction,
        });
        syncClaimHeartbeat(leadId);
      },

      logActivity: (leadId, activity, note) => {
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? {
                  ...l,
                  lastActionAt: now(),
                  events: [...l.events, ev(s.me, activity, note?.trim() || undefined)],
                }
              : l,
          ),
        }));
        syncHosted(leadId, "activity_logged", note?.trim() || activity);
        syncClaimHeartbeat(leadId);
      },

      editFields: (leadId, values, reason, stepKey) => {
        set((s) => ({
          leads: s.leads.map((l) => {
            if (l.id !== leadId) return l;
            const changes = Object.entries(values).map(([field, to]) => ({ field, from: l.f?.[field] ?? "", to }));
            return {
              ...l,
              f: { ...l.f, ...values },
              lastActionAt: now(),
              events: [
                ...l.events,
                {
                  ...ev(s.me, "Answer edited", `${changes.map((c) => `${c.field}: ${c.from || "empty"} → ${c.to}`).join(" · ")}${reason ? ` — ${reason}` : ""}`),
                  stepKey,
                  changes,
                },
              ],
            };
          }),
        }));
        const patch: Record<string, unknown> = {};
        if (values.area) patch.location_text = values.area;
        if (values.moveIn) patch.movein_date = values.moveIn;
        syncHosted(leadId, "answers_edited", reason, Object.keys(patch).length ? patch : undefined);
        syncClaimHeartbeat(leadId);
      },

      claim: (leadId) => {
        const before = get().leads.find((item) => item.id === leadId);
        if (!before || before.owner) return;
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? { ...l, owner: s.me, handler: s.me, ownedAt: now(), hostedClaimError: null, events: [...l.events, ev(s.me, "Took ownership")] }
              : l,
          ),
        }));
        const optimistic = get().leads.find((item) => item.id === leadId)!;
        if (!optimistic.hostedLeadId) return;
        void claimFlowLead(optimistic).then((claimId) => {
          set((s) => ({ leads: s.leads.map((l) => l.id === leadId ? { ...l, hostedClaimId: claimId, hostedClaimError: null } : l) }));
          syncHosted(leadId, "ownership_claimed", `Claimed by ${optimistic.owner ?? get().me}`, { current_handler_name: optimistic.owner, current_mission: optimistic.nextAction ?? null });
        }).catch((error) => {
          const message = error instanceof Error ? error.message : "Hosted customer claim failed";
          set((s) => ({ leads: s.leads.map((l) => l.id === leadId ? { ...l, owner: before.owner, handler: before.handler, ownedAt: before.ownedAt, hostedClaimError: message, events: [...l.events, ev(s.me, "Hosted claim failed", message)] } : l) }));
        });
      },

      toggleLabel: (leadId, label) =>
        set((s) => ({
          leads: s.leads.map((l) => {
            if (l.id !== leadId) return l;
            const on = l.labels.includes(label);
            return {
              ...l,
              labels: on ? l.labels.filter((x) => x !== label) : [...l.labels, label],
              events: [...l.events, ev(s.me, on ? `Label removed — ${label}` : `Label added — ${label}`)],
            };
          }),
        })),

      setTemp: (leadId, temp, reason) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId ? { ...l, temp, tempReason: reason, events: [...l.events, ev(s.me, `Forced ${temp.toLowerCase()}`, reason)] } : l,
          ),
        })),

      reassign: (leadId, handler) => {
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId ? { ...l, handler, owner: handler, events: [...l.events, ev(s.me, `Owner changed to ${handler}`)] } : l,
          ),
        }));
        syncHosted(leadId, "owner_changed", `Owner changed to ${handler}`, { current_handler_name: handler });
      },

      moveStage: (leadId, stage, reason) => {
        set((s) => ({
          leads: s.leads.map((l) => (l.id === leadId ? { ...l, stage, events: [...l.events, ev(s.me, `Moved to ${stage}`, reason)] } : l)),
        }));
        const hostedStage = stagePatch(stage);
        syncHosted(leadId, "stage_changed", reason, hostedStage ? { current_pipeline_stage: hostedStage } : undefined);
      },

      bulk: (leadIds, patch, reason) =>
        set((s) => {
          const ids = new Set(leadIds);
          return {
            leads: s.leads.map((l) =>
              ids.has(l.id)
                ? {
                    ...l,
                    ...(patch.handler ? { handler: patch.handler, owner: patch.handler } : {}),
                    ...(patch.nextAction ? { nextAction: patch.nextAction } : {}),
                    ...(patch.nextActionAt ? { nextActionAt: patch.nextActionAt } : {}),
                    ...(patch.temp ? { temp: patch.temp, tempReason: reason } : {}),
                    ...(patch.escalate ? { escalated: true, stage: "CONTROL_TOWER" } : {}),
                    events: [...l.events, ev(s.me, "Bulk action applied", reason)],
                  }
                : l,
            ),
          };
        }),

      escalate: (leadId, reason) => {
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === leadId
              ? { ...l, escalated: true, stage: "CONTROL_TOWER", events: [...l.events, ev(s.me, "Sent to Control Tower", reason)] }
              : l,
          ),
        }));
        syncHosted(leadId, "escalated", reason, { current_handler_name: "Control Tower", primary_blocker: reason, current_pipeline_stage: "CONTROL_TOWER" });
      },

      reset: () => set({ rows: seedCapturedRows(), leads: seedLeads(), batches: [] }),
      });
    },
    { name: "gharpayy-booking-flow-v2", version: 2 },
  ),
);
