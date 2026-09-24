// Bridge — every WhatsApp conversation is guaranteed a CRM record.
import { useEffect, useMemo, useState } from "react";
import { useIdentityStore } from "@/lib/lead-identity/store";
import { useWa } from "@/wa/store";
import { useMovement } from "./store";
import type { MovementState } from "./types";
import { normalizePhoneIN } from "@/lib/lead-identity/normalize";
import { loadHostedMovementSeeds, type HostedMovementSeed } from "./hosted";

/**
 * Auto-ingestion: keeps a Movement state for every known lead, matching on the
 * normalised phone number. Conversations whose phone cannot be matched land in
 * the Unmatched queue instead of silently disappearing.
 */
export function useMovementSync() {
  const leads = useIdentityStore((s) => s.leads);
  const me = useIdentityStore((s) => s.currentUser);
  const unread = useWa((s) => s.unread);
  const claims = useWa((s) => s.claims);
  const ensureMany = useMovement((s) => s.ensureMany);
  const setActor = useMovement((s) => s.setActor);
  const states = useMovement((s) => s.states);
  const [hosted, setHosted] = useState<HostedMovementSeed[]>([]);

  useEffect(() => {
    setActor({ id: me.id, name: me.name, role: "flow-ops", zone: "KORA CORE" });
  }, [me.id, me.name, setActor]);

  useEffect(() => {
    ensureMany(
      leads.map((l) => ({
        ulid: l.ulid,
        name: l.name,
        phone: l.phoneE164 || normalizePhoneIN(l.phoneRaw || ""),
        ownerId: claims[l.ulid]?.ownerId ?? l.assigneeId ?? l.primaryOwnerId ?? "",
        ownerName: claims[l.ulid]?.ownerName ?? l.assigneeName ?? "Unassigned",
        unread: unread[l.ulid]?.count ?? 0,
        lastCustomerMsgAt: l.lastActivityAt ?? l.updatedAt,
        checkInDate: l.earliestCheckIn ?? l.moveInDate ?? null,
      })),
    );
  }, [leads, unread, claims, ensureMany]);

  useEffect(() => {
    let alive = true;
    void loadHostedMovementSeeds(leads.map((lead) => ({
      ulid: lead.ulid,
      phone: lead.phoneE164 || normalizePhoneIN(lead.phoneRaw || ""),
      name: lead.name,
    }))).then((rows) => {
      if (alive) setHosted(rows);
    }).catch((error) => {
      console.warn("Hosted Movement data unavailable; local records remain active", error);
    });
    return () => { alive = false; };
  }, [leads]);

  useEffect(() => {
    if (!hosted.length) return;
    ensureMany(hosted.map((row) => ({
      ulid: row.localUlid,
      hostedLeadId: row.id,
      hostedNextActionId: row.nextActionId,
      hostedEvents: row.history,
      name: row.name ?? undefined,
      phone: row.phone ?? undefined,
      zone: row.zone ?? undefined,
      ownerId: "",
      ownerName: row.ownerName,
      unread: row.unread,
      lastCustomerMsg: row.lastMessage,
      lastCustomerMsgAt: row.lastMessage ? new Date().toISOString() : null,
      checkInDate: row.moveInDate,
      hostedState: {
        hostedLeadId: row.id,
        hostedNextActionId: row.nextActionId,
        name: row.name ?? undefined,
        phone: row.phone ?? undefined,
        zone: row.zone ?? "",
        stage: row.stage,
        primaryOwnerName: row.ownerName,
        nextAction: row.nextAction,
        unread: row.unread,
        lastCustomerMsg: row.lastMessage,
        checkInDate: row.moveInDate,
      },
    })));
  }, [hosted, ensureMany]);

  const list = useMemo(() => Object.values(states), [states]);

  const nameOf = useMemo(() => {
    const m = new Map<string, { name: string; phone: string; area: string }>();
    leads.forEach((l) =>
      m.set(l.ulid, {
        name: l.name || l.phoneE164 || "Unknown",
        phone: l.phoneE164 || normalizePhoneIN(l.phoneRaw || ""),
        area: l.area || l.zone || "—",
      }),
    );
    hosted.forEach((l) => {
      if (!m.has(l.localUlid)) m.set(l.localUlid, {
        name: l.name || l.phone || "Unknown",
        phone: l.phone || "",
        area: l.zone || "—",
      });
    });
    return m;
  }, [leads, hosted]);

  return { list, nameOf, me };
}
