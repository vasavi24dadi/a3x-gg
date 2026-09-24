import { useMemo, useState } from "react";
import { Check, Images, Merge, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBookingFlow } from "./store";
import { phoneKey } from "@/lib/canonical/customer-id";

const initials = (n: string) => n.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function Capture({ onDone }: { onDone: () => void }) {
  const { rows, leads, mode, addRow, mergeRow, ignoreRow, addAllNew, resetCapture } = useBookingFlow();
  const [loaded, setLoaded] = useState(false);
  const phoneCounts = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => {
      const key = phoneKey(lead.phone);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [leads]);

  const visible = loaded ? rows : [];
  const added = rows.filter((r) => r.status === "ADDED").length;
  const merged = rows.filter((r) => r.status === "MERGED").length;
  const pending = rows.filter((r) => r.status === "NEW").length;

  return (
    <div className="space-y-4">
      <header className="rounded-lg border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Step 1 of 3 · Bring chats in</p>
        <h2 className="text-lg font-semibold">Every customer starts as a WhatsApp screenshot</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the chat screenshots, then decide for each row: add as a new customer, merge into the one we already have, or ignore.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { setLoaded(true); toast.success(`${rows.length} chats read from the screenshots`); }}>
            <Images className="mr-1.5 h-4 w-4" />{loaded ? "Read again" : "Read screenshots"}
          </Button>
          {mode === "EXPERT" && loaded && (
            <Button size="sm" variant="secondary" onClick={() => { const n = addAllNew(); toast.success(`${n} customers added in one go`); }}>
              Add all new rows
            </Button>
          )}
          {loaded && (
            <Button size="sm" variant="ghost" onClick={() => { resetCapture(); setLoaded(false); }}>Start over</Button>
          )}
        </div>
      </header>

      {loaded && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary">{added} added</Badge>
          <Badge variant="secondary">{merged} merged</Badge>
          <Badge variant="outline">{pending} still to decide</Badge>
          <Button size="sm" className="ml-auto" disabled={added + merged === 0} onClick={onDone}>
            Continue to my batch
          </Button>
        </div>
      )}

      {!loaded ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nothing read yet. Press “Read screenshots” and the WhatsApp inbox appears exactly as it looks on the phone.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border" style={{ background: "#0b141a" }}>
          {visible.map((r) => {
            const phone = phoneKey(r.phone);
            const known = Boolean(phone && phoneCounts.get(phone) === 1);
            return (
              <div key={r.id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0" style={{ borderColor: "#1f2c34" }}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold" style={{ background: "#2a3942", color: "#e9edef" }}>
                  {initials(r.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium" style={{ color: "#e9edef" }}>{r.name}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: r.unread ? "#25d366" : "#8696a0" }}>{r.time}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs" style={{ color: "#8696a0" }}>
                      {r.outgoing ? "✓✓ " : ""}{r.lastMessage}
                    </span>
                    {r.unread > 0 && (
                      <span className="ml-auto rounded-full px-1.5 text-[10px] font-semibold" style={{ background: "#25d366", color: "#0b141a" }}>{r.unread}</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-[10px]" style={{ color: "#667781" }}>{r.phone}</span>
                    {r.labels.map((l) => (
                      <span key={l} className="rounded px-1 text-[10px]" style={{ background: "#1f2c34", color: "#8696a0" }}>{l}</span>
                    ))}
                    {known && <span className="rounded px-1 text-[10px]" style={{ background: "#1f2c34", color: "#53bdeb" }}>already in CRM</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  {r.status === "NEW" ? (
                    <>
                      <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => addRow(r.id)}><Check className="mr-1 h-3 w-3" />Add</Button>
                      <Button size="sm" variant="secondary" className="h-7 px-2 text-[11px]" disabled={!known} onClick={() => mergeRow(r.id)}>
                        <Merge className="mr-1 h-3 w-3" />Merge
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground" onClick={() => ignoreRow(r.id)}>
                        <X className="mr-1 h-3 w-3" />Ignore
                      </Button>
                    </>
                  ) : (
                    <Badge variant={r.status === "IGNORED" ? "outline" : "secondary"} className="text-[10px]">{r.status.toLowerCase()}</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
