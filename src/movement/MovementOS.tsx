import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useMovementSync } from "./bridge";
import { seedMovement } from "./seed";
import {
  ActiveList, Dashboards, DraftingPanel, JourneyTimeline, UnmatchedQueue, WorkPanel,
} from "./components";

export function MovementOS() {
  useEffect(() => { seedMovement(); }, []);
  // If persisted movement store was hydrated as empty, ensure local identity leads
  // are materialised into movement state so the UI shows demo customers.
  useEffect(() => {
    try {
      // lazy access to avoid bundler/ssr issues
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const m = require("./store").useMovement;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const identity = require("@/lib/lead-identity/store").useIdentityStore;
      const ensureMany = m.getState().ensureMany;
      const states = Object.keys(m.getState().states || {});
      if (states.length === 0) {
        const leads = identity.getState().leads || [];
        if (leads.length) {
          ensureMany(
            leads.map((l: any) => ({ ulid: l.ulid, name: l.name, phone: l.phoneE164 || l.phoneRaw, ownerId: l.assigneeId ?? l.primaryOwnerId ?? "", ownerName: l.assigneeName ?? "Unassigned", unread: 0, lastCustomerMsgAt: l.lastActivityAt ?? l.updatedAt, checkInDate: l.earliestCheckIn ?? l.moveInDate ?? null })),
          );
        }
      }
    } catch (e) {
      // keep silent — non-fatal
    }
  }, []);
  const { list, nameOf, me } = useMovementSync();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && list.length) setSelected(list[0].ulid);
  }, [list, selected]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center">
          <Compass className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h1 className="text-sm font-semibold leading-tight">Customer Movement OS</h1>
          <p className="text-[10px] text-muted-foreground leading-tight">
            One journey · draft → priority → live work → handoff → outcome
          </p>
        </div>
      </div>

      <Tabs defaultValue="work">
        <TabsList>
          <TabsTrigger value="work">Work</TabsTrigger>
          <TabsTrigger value="drafting">Drafting</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboards</TabsTrigger>
          <TabsTrigger value="stream">Journey</TabsTrigger>
          <TabsTrigger value="unmatched">Unmatched</TabsTrigger>
        </TabsList>

        <TabsContent value="work" className="mt-3">
          <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-3">
            <ActiveList list={list} meta={nameOf} selected={selected} onSelect={setSelected} meId={me.id} />
            <div className="space-y-3">
              <WorkPanel ulid={selected} meta={nameOf} />
              <JourneyTimeline ulid={selected} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="drafting" className="mt-3">
          <DraftingPanel list={list} meta={nameOf} />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-3">
          <Dashboards list={list} meta={nameOf} />
        </TabsContent>

        <TabsContent value="stream" className="mt-3">
          <JourneyTimeline ulid={null} />
        </TabsContent>

        <TabsContent value="unmatched" className="mt-3">
          <UnmatchedQueue />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default MovementOS;
