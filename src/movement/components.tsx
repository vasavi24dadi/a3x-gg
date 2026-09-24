import { useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, Flame, Lock, MessageSquare,
  Phone, Play, RefreshCw, Timer, TrendingDown, Unlock, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMovement } from "./store";
import { active13, drafting30, rank, type Scored } from "./priority";
import { funnel, leaks, lossReasons, operatorBoard, totals } from "./metrics";
import { DRAFT_META, PRIORITY_LABEL, type DraftCode, type MovementState } from "./types";

type Meta = Map<string, { name: string; phone: string; area: string }>;

const rel = (iso?: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

const deadlineLabel = (iso?: string | null) => {
  if (!iso) return null;
  const mins = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (mins > 0) return `Overdue by ${mins}m`;
  const remaining = Math.max(1, -mins);
  return `Due in ${remaining < 60 ? `${remaining}m` : `${Math.round(remaining / 60)}h`}`;
};

const HEALTH_CLS: Record<string, string> = {
  healthy: "bg-success/15 text-success",
  "due-soon": "bg-warning/15 text-warning",
  "action-due": "bg-warning/20 text-warning",
  "at-risk": "bg-destructive/15 text-destructive",
  breached: "bg-destructive/25 text-destructive",
  stuck: "bg-muted text-muted-foreground",
};

export function DraftChip({ code }: { code: DraftCode | null }) {
  if (!code) return <Badge variant="outline" className="text-[10px]">no draft</Badge>;
  const tone =
    code === "D1" ? "bg-destructive/15 text-destructive"
      : code === "D2" ? "bg-warning/15 text-warning"
        : code === "D3" ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground";
  return <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", tone)}>{code}</span>;
}

/* ─────────────── Drafting 30 ─────────────── */

export function DraftingPanel({ list, meta }: { list: MovementState[]; meta: Meta }) {
  const mv = useMovement();
  const selection = useMovement((s) => s.selection);
  const activeBatchId = useMovement((s) => s.activeBatchId);
  const batches = useMovement((s) => s.batches);
  const queue = useMemo(() => drafting30(list), [list]);
  const batch = batches.find((b) => b.id === activeBatchId) ?? null;
  const [i, setI] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  // Rows in the batch that still have no draft mark.
  const batchRows = useMemo(
    () => (batch ? batch.ulids.map((u) => list.find((s) => s.ulid === u)).filter(Boolean) as MovementState[] : []),
    [batch, list],
  );
  const cur = batch ? batchRows[Math.min(i, Math.max(batchRows.length - 1, 0))] : queue[0];

  const selected = new Set(selection);

  const mark = (code: DraftCode) => {
    if (!cur) return;
    mv.draft(cur.ulid, code, batch?.id, `${i + 1}/${batchRows.length || queue.length}`);
    if (batch) {
      mv.advanceBatch(batch.id, Date.now() - tick);
      setTick(Date.now());
    }
    setI((n) => n + 1);
  };

  const markSelection = (code: DraftCode) => {
    if (!selection.length) return;
    const b = mv.startBatch("G1", selection);
    selection.forEach((u, idx) => mv.draft(u, code, b.id, `${idx + 1}/${selection.length}`));
    mv.endBatch(b.id);
    toast.success(`${selection.length} chats marked ${code}`);
  };

  return (
    <div className="space-y-3">
      {/* ── Selection controls ── */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mr-auto">
            Drafting queue · {queue.length} undrafted · {selection.length} selected
          </div>
          <Button size="sm" variant="outline" className="h-7 text-[11px]"
            onClick={() => mv.setSelection(queue.slice(0, 30).map((s) => s.ulid))}>
            Select next 30
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => mv.clearSelection()}>
            Clear
          </Button>
          <Button size="sm" className="h-7 text-[11px]" disabled={!selection.length}
            onClick={() => {
              const b = mv.startBatch("G1", selection);
              setI(0); setTick(Date.now());
              toast.success(`Batch ${b.id} started · ${b.size} chats`);
            }}>
            Start batch ({selection.length})
          </Button>
        </div>
        {!!selection.length && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className="text-[11px] text-muted-foreground self-center mr-1">Mark all selected:</span>
            {(Object.keys(DRAFT_META) as DraftCode[]).map((code) => (
              <Button key={code} size="sm" variant="outline" className="h-7 text-[11px]"
                onClick={() => markSelection(code)}>
                {code}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* ── Current chat card ── */}
      {cur ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
              {batch
                ? `Batch ${batch.id} · ${Math.min(i + 1, batchRows.length)} of ${batchRows.length}`
                : `Drafting · ${Math.min(i + 1, queue.length)} of ${queue.length}`}
            </div>
            <Badge variant="outline" className="text-[10px]">
              <Timer className="h-3 w-3 mr-1" /> ~10s per chat
            </Badge>
          </div>
          <div className="text-lg font-semibold">{meta.get(cur.ulid)?.name ?? cur.ulid}</div>
          <div className="text-xs text-muted-foreground">
            {meta.get(cur.ulid)?.phone} · {meta.get(cur.ulid)?.area} · last message {rel(cur.lastCustomerMsgAt)} ago
          </div>
          {cur.waDraft && cur.crmDraft && cur.waDraft !== cur.crmDraft && (
            <div className="mt-2 text-xs text-warning flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              WhatsApp says {cur.waDraft}, CRM says {cur.crmDraft}
              <Button size="sm" variant="ghost" className="h-6 text-[11px]"
                onClick={() => { mv.syncDraft(cur.ulid); toast.success("Draft synced"); }}>
                Sync
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            {(Object.keys(DRAFT_META) as DraftCode[]).map((code) => (
              <button key={code} onClick={() => mark(code)}
                className="rounded-lg border border-border p-3 text-left hover:border-primary hover:bg-primary/5 transition">
                <div className="font-semibold text-sm">{DRAFT_META[code].label}</div>
                <div className="text-[11px] text-muted-foreground">{DRAFT_META[code].hint}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="ghost" onClick={() => setI((n) => Math.max(0, n - 1))}>Back</Button>
            <Button size="sm" variant="ghost" onClick={() => setI((n) => n + 1)}>Skip</Button>
            {batch && (
              <Button size="sm" variant="outline" className="ml-auto"
                onClick={() => { mv.endBatch(batch.id); setI(0); toast.success(`Batch ${batch.id} closed`); }}>
                End batch
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-5 w-5 mx-auto mb-2 text-success" />
          Every conversation is drafted. Nothing hidden, nothing pending.
        </div>
      )}

      {/* ── Selectable list ── */}
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {(batch ? batchRows : queue).map((s, idx) => (
          <button key={s.ulid} onClick={() => mv.toggleSelect(s.ulid)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition">
            <span className={cn(
              "h-4 w-4 rounded border flex items-center justify-center text-[10px]",
              selected.has(s.ulid) ? "bg-primary border-primary text-primary-foreground" : "border-border",
            )}>
              {selected.has(s.ulid) ? "✓" : ""}
            </span>
            <span className="text-[11px] text-muted-foreground w-6 tabular-nums">{idx + 1}</span>
            <span className="text-xs font-medium truncate flex-1">{meta.get(s.ulid)?.name ?? s.ulid}</span>
            <span className="text-[10px] text-muted-foreground">{rel(s.lastCustomerMsgAt)} ago</span>
            <DraftChip code={s.crmDraft} />
          </button>
        ))}
        {!(batch ? batchRows : queue).length && (
          <div className="p-3 text-xs text-muted-foreground">Nothing waiting to be drafted.</div>
        )}
      </div>

      {/* ── Batch history ── */}
      {!!batches.length && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Batch history
          </div>
          {batches.slice(0, 6).map((b) => (
            <div key={b.id} className="flex items-center justify-between text-xs py-1">
              <span>{b.id} · {b.operatorName}</span>
              <span className="text-muted-foreground tabular-nums">
                {b.perLeadMs.length}/{b.size} drafted{b.endedAt ? " · closed" : " · live"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/* ─────────────── Active 13 ─────────────── */

export function ActiveList({
  list, meta, selected, onSelect, meId,
}: { list: MovementState[]; meta: Meta; selected: string | null; onSelect: (u: string) => void; meId: string }) {
  const rows = useMemo(() => active13(list, meId), [list, meId]);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          Active 13 — work top to bottom
        </span>
        <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
      </div>
      <div className="divide-y divide-border max-h-[62vh] overflow-auto">
        {rows.map((r, idx) => <ActiveRow key={r.ulid} n={idx + 1} r={r} meta={meta}
          active={selected === r.ulid} onSelect={onSelect} />)}
        {!rows.length && (
          <div className="p-6 text-center text-sm text-muted-foreground">Queue clear.</div>
        )}
      </div>
    </div>
  );
}

function ActiveRow({ n, r, meta, active, onSelect }: {
  n: number; r: Scored; meta: Meta; active: boolean; onSelect: (u: string) => void;
}) {
  const info = meta.get(r.ulid);
  return (
    <button onClick={() => onSelect(r.ulid)}
      className={cn("w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-muted/50 transition",
        active && "bg-primary/5")}>
      <span className="text-xs font-mono text-muted-foreground w-5 pt-0.5">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{info?.name ?? r.ulid}</span>
          <DraftChip code={r.state.crmDraft} />
          {r.state.currentOperatorName && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Lock className="h-3 w-3" />{r.state.currentOperatorName}
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {r.state.stage} · {r.reason}
          {r.state.nextAction && ` · next: ${r.state.nextAction.kind}`}
        </div>
      </div>
      <div className="text-right shrink-0 space-y-1">
        <Badge className={cn("text-[10px]", r.bucket === "P0" ? "bg-destructive text-destructive-foreground" : "")}>
          {r.bucket}
        </Badge>
        <div className={cn("text-[10px] px-1.5 py-0.5 rounded", HEALTH_CLS[r.health])}>{r.health}</div>
      </div>
    </button>
  );
}

/* ─────────────── Work panel (live lock) ─────────────── */

export function WorkPanel({ ulid, meta }: { ulid: string | null; meta: Meta }) {
  const mv = useMovement();
  const st = useMovement((s) => (ulid ? s.states[ulid] : undefined));
  const lock = useMovement((s) => (ulid ? s.locks[ulid] : undefined));
  const [note, setNote] = useState("");

  if (!ulid || !st) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Pick a customer from the Active 13 to open the live work panel.
      </div>
    );
  }
  const info = meta.get(ulid);
  const held = !!lock;

  const nextIn = (mins: number, kind: Parameters<typeof mv.setNextAction>[1]["kind"]) => {
    mv.setNextAction(ulid, {
      kind, dueAt: new Date(Date.now() + mins * 60000).toISOString(),
      ownerId: st.primaryOwnerId, ownerName: st.primaryOwnerName, note,
    });
    toast.success(`Next action set in ${mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`}`);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">{info?.name ?? ulid}</div>
          <div className="text-xs text-muted-foreground">
            {info?.phone} · {info?.area} · owner {st.primaryOwnerName}
          </div>
        </div>
        {held ? (
          <Button size="sm" variant="outline" onClick={() => mv.release(ulid)}>
            <Unlock className="h-3.5 w-3.5 mr-1" /> Release
          </Button>
        ) : (
          <Button size="sm" onClick={() => mv.attemptClaim(ulid, "work", "work this customer")}>
            <Play className="h-3.5 w-3.5 mr-1" /> Start work
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
        <Cell label="Draft"><DraftChip code={st.crmDraft} /></Cell>
        <Cell label="Stage">{st.stage}</Cell>
        <Cell label="Work">{st.work}</Cell>
        <Cell label="Next action">
          {st.nextAction ? `${st.nextAction.kind} · ${new Date(st.nextAction.dueAt).toLocaleTimeString()}` : "—"}
        </Cell>
        <Cell label="Deadline">
          {st.nextAction ? (
            <span className={cn(new Date(st.nextAction.dueAt).getTime() < Date.now() && "text-destructive")}>
              {new Date(st.nextAction.dueAt).toLocaleString()} · {deadlineLabel(st.nextAction.dueAt)}
            </span>
          ) : "No deadline"}
        </Cell>
        <Cell label="Waiting">{st.customerWaitingSince ? `${rel(st.customerWaitingSince)} ago` : "—"}</Cell>
        <Cell label="Tour">{st.tourAt ? `${new Date(st.tourAt).toLocaleString()}${st.tourConfirmed ? " ✓" : " (unconfirmed)"}` : "—"}</Cell>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Call</div>
        <div className="flex flex-wrap gap-1.5">
          {(["connected", "no-answer", "busy", "wrong-number", "rejected"] as const).map((r) => (
            <Button key={r} size="sm" variant="outline" className="h-7 text-[11px]"
              onClick={() => { mv.logCall(ulid, r, note); toast.success(`Call logged: ${r}`); }}>
              <Phone className="h-3 w-3 mr-1" />{r}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Movement</div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => mv.qualify(ulid, true, st.checkInDate)}>Definitely close</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => mv.setStage(ulid, "matched", "Properties shared")}>Shared options</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]"
            onClick={() => mv.scheduleTour(ulid, new Date(Date.now() + 86400000).toISOString())}>Schedule tour</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => mv.confirmTour(ulid)}>Confirm tour</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => mv.tourDone(ulid)}>Tour done</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => mv.tourOutcome(ulid, "positive")}>Positive</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => mv.sendQuote(ulid)}>Send quote</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => mv.prebook(ulid, "payment-intent")}>Payment intent</Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={() => { mv.book(ulid); toast.success("Booked"); }}>Booked</Button>
          <Button size="sm" variant="destructive" className="h-7 text-[11px]"
            onClick={() => mv.exit(ulid, "no-response", note)}>Exit</Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
          Next action (mandatory before you leave)
        </div>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the next step…" className="h-8 text-xs" />
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => nextIn(30, "call")}>Call in 30m</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => nextIn(120, "whatsapp")}>WhatsApp in 2h</Button>
          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => nextIn(1440, "recheck-later")}>Tomorrow</Button>
          {st.nextAction && (
            <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => mv.completeNextAction(ulid)}>
              <CheckCircle2 className="h-3 w-3 mr-1" /> Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border px-2 py-1.5">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-xs font-medium truncate">{children}</div>
    </div>
  );
}

/* ─────────────── Journey timeline ─────────────── */

export function JourneyTimeline({ ulid }: { ulid: string | null }) {
  const events = useMovement((s) => s.events);
  const rows = useMemo(
    () => (ulid ? events.filter((e) => e.ulid === ulid).slice(0, 60) : events.slice(0, 60)),
    [events, ulid],
  );
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {ulid ? "Customer journey" : "Live event stream"}
      </div>
      <div className="divide-y divide-border max-h-[52vh] overflow-auto">
        {rows.map((e) => (
          <div key={e.id} className="px-3 py-2 text-xs flex gap-2">
            <span className="text-muted-foreground w-12 shrink-0">{rel(e.ts)}</span>
            <span className="flex-1">{e.text}</span>
            <span className="text-muted-foreground shrink-0">{e.actorName}</span>
          </div>
        ))}
        {!rows.length && <div className="p-6 text-center text-sm text-muted-foreground">No events yet.</div>}
      </div>
    </div>
  );
}

/* ─────────────── Dashboards ─────────────── */

export function Dashboards({ list, meta }: { list: MovementState[]; meta: Meta }) {
  const events = useMovement((s) => s.events);
  const snapshot = useMovement((s) => s.snapshot);
  const t = useMemo(() => totals(list, events), [list, events]);
  const f = useMemo(() => funnel(list), [list]);
  const lk = useMemo(() => leaks(list), [list]);
  const lr = useMemo(() => lossReasons(list), [list]);
  const board = useMemo(() => operatorBoard(list, events), [list, events]);
  const hot = useMemo(() => rank(list).slice(0, 5), [list]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <Kpi label="Conversations" value={t.conversations} icon={MessageSquare} />
        <Kpi label="Drafted" value={`${t.drafted}/${t.conversations}`} icon={CheckCircle2} />
        <Kpi label="D1 immediate" value={t.d1} icon={Flame} tone="destructive" />
        <Kpi label="Customer waiting" value={t.p0} icon={Clock} tone="destructive" />
        <Kpi label="Calls today" value={`${t.connected}/${t.calls}`} icon={Phone} />
        <Kpi label="Booked today" value={t.booked} icon={CheckCircle2} tone="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Conversion funnel
          </div>
          <div className="space-y-1.5">
            {f.map((row) => (
              <div key={row.stage} className="flex items-center gap-2">
                <span className="text-[11px] w-28 capitalize">{row.stage.replace("-", " ")}</span>
                <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${row.pct}%` }} />
                </div>
                <span className="text-[11px] w-16 text-right tabular-nums">
                  {row.count}
                  {row.dropFromPrev > 0 && <span className="text-destructive"> −{row.dropFromPrev}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Leakage watchtower
          </div>
          <div className="space-y-1">
            {lk.map((l) => (
              <div key={l.label} className="flex items-center justify-between text-xs py-1">
                <div>
                  <div className={cn(l.count > 0 && "font-medium")}>{l.label}</div>
                  <div className="text-[10px] text-muted-foreground">{l.hint}</div>
                </div>
                <Badge variant={l.count > 0 ? "destructive" : "outline"} className="text-[10px]">{l.count}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1">
            <Users className="h-3 w-3" /> Operator board
          </div>
          {board.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-xs py-1">
              <span className="truncate">{b.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {b.live} live · {b.booked} booked · {b.touches} touches
                {b.breached > 0 && <span className="text-destructive"> · {b.breached} SLA</span>}
              </span>
            </div>
          ))}
          {!board.length && <div className="text-xs text-muted-foreground">No owners yet.</div>}
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1">
            <TrendingDown className="h-3 w-3" /> Why we lost
          </div>
          {lr.map((r) => (
            <div key={r.reason} className="flex items-center justify-between text-xs py-1">
              <span className="capitalize">{r.reason.replace(/-/g, " ")}</span>
              <span className="tabular-nums text-muted-foreground">{r.count}</span>
            </div>
          ))}
          {!lr.length && <div className="text-xs text-muted-foreground">No exits recorded.</div>}
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Top priority right now
          </div>
          {hot.map((h) => (
            <div key={h.ulid} className="flex items-center justify-between text-xs py-1">
              <span className="truncate">{meta.get(h.ulid)?.name ?? h.ulid}</span>
              <span className="text-muted-foreground">{PRIORITY_LABEL[h.bucket]}</span>
            </div>
          ))}
          <div className="flex gap-1.5 mt-3">
            {(["1PM", "5PM", "EOD"] as const).map((lbl) => (
              <Button key={lbl} size="sm" variant="outline" className="h-7 text-[11px]"
                onClick={() => {
                  snapshot({
                    label: lbl,
                    operatorId: "u-self",
                    totals: t as unknown as Record<string, number>,
                    required: { drafted: 30, calls: 20, tours: 4, booked: 2 },
                    status: t.booked >= 2 ? "ON TRACK" : "BEHIND",
                    mainLeak: lk.find((l) => l.count > 0)?.label ?? "none",
                    inference: `${t.drafted}/${t.conversations} drafted · ${t.connected}/${t.calls} connected · ${t.booked} booked`,
                  });
                  toast.success(`${lbl} checkpoint saved`);
                }}>
                {lbl} checkpoint
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone }: {
  label: string; value: number | string; icon: typeof Clock; tone?: "success" | "destructive";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className={cn("text-xl font-semibold mt-0.5",
        tone === "success" && "text-success", tone === "destructive" && "text-destructive")}>
        {value}
      </div>
    </div>
  );
}

/* ─────────────── Unmatched queue ─────────────── */

export function UnmatchedQueue() {
  const unmatched = useMovement((s) => s.unmatched);
  const retry = useMovement((s) => s.retryUnmatched);
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        Unmatched conversations — nothing is dropped silently
      </div>
      <div className="divide-y divide-border">
        {unmatched.map((u) => (
          <div key={u.id} className="px-3 py-2 flex items-center justify-between text-xs">
            <div>
              <div className="font-medium">{u.name ?? u.phoneRaw}</div>
              <div className="text-[11px] text-muted-foreground">{u.reason} · {u.waAccount} · {rel(u.ts)} ago</div>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => retry(u.id)}>
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          </div>
        ))}
        {!unmatched.length && (
          <div className="p-6 text-center text-sm text-muted-foreground">Every conversation matched a CRM record.</div>
        )}
      </div>
    </div>
  );
}
