"use client";

/**
 * Load + autosave for the Phase 3 block config (FN-15/22/27/28/30 and locales).
 *
 * The four panels live on four different wizard blocks, so each page would
 * otherwise repeat the same fetch/patch/save-state plumbing. Keeping it here
 * means one place decides what "saved", "saving" and "offline" mean, and the
 * pages stay about their own block.
 *
 * Writes are optimistic: local state updates immediately so typing is not
 * blocked on the round trip, and a failure flips the footer to "offline" rather
 * than silently discarding what was typed. It does not roll the value back — a
 * designer who saw their text appear and then vanish would retype it. A failed
 * save puts its unsent fields back into the pending batch (newer edits win per
 * key) and the next patch() re-arms the timer, so the next successful save
 * carries them. Saves are serialised, and there is no automatic retry. A failed
 * flush-on-unmount has no later patch, so that last edit is still lost.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchServiceDefinition,
  updateServiceDefinition,
  type ServiceDefinitionDto,
} from "./designerApi";

export type SaveState = "saving" | "saved" | "offline";

/** The Phase 3 slice of a definition, as the panels read and write it. */
export interface Phase3Config {
  locales: string[];
  officeOverrides: NonNullable<ServiceDefinitionDto["officeOverrides"]>;
  webhookSubscriptions: NonNullable<ServiceDefinitionDto["webhookSubscriptions"]>;
  appealLinkage: ServiceDefinitionDto["appealLinkage"];
  rtiLinkage: ServiceDefinitionDto["rtiLinkage"];
  renewalPolicy: ServiceDefinitionDto["renewalPolicy"];
  offeringOfficeIds: string[];
}

const EMPTY: Phase3Config = {
  locales: [],
  officeOverrides: [],
  webhookSubscriptions: [],
  appealLinkage: null,
  rtiLinkage: null,
  renewalPolicy: null,
  offeringOfficeIds: [],
};

export function usePhase3Config(definitionId: string) {
  const [config, setConfig] = useState<Phase3Config>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");

  useEffect(() => {
    let cancelled = false;
    fetchServiceDefinition(definitionId)
      .then((def) => {
        if (cancelled) return;
        setConfig({
          locales: def.locales ?? [],
          officeOverrides: def.officeOverrides ?? [],
          webhookSubscriptions: def.webhookSubscriptions ?? [],
          appealLinkage: def.appealLinkage ?? null,
          rtiLinkage: def.rtiLinkage ?? null,
          renewalPolicy: def.renewalPolicy ?? null,
          offeringOfficeIds: (def as { offeringOfficeIds?: string[] }).offeringOfficeIds ?? [],
        });
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Leave the panels on empty defaults but say the connection failed, so a
        // designer does not read "nothing configured" as fact.
        setSaveState("offline");
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [definitionId]);

  // Pending edits are coalesced and flushed on a timer, matching the 2s debounce
  // the other Designer forms use. This is not only about network chatter: an
  // update is a CQRS command, so every call becomes an outbox message, a
  // consumer apply, an audit row and a cache invalidation. Saving per keystroke
  // would turn typing one designation into two dozen audit entries.
  const pending = useRef<Partial<Phase3Config>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // CLOS3-S1-08: saves are serialised through this promise. A save takes its batch only after the
  // previous save settled, so a failed batch is always restored into `pending` first and a slow
  // failure can never overwrite a newer edit that was saved in the meantime. While nothing is in
  // flight the first save still starts synchronously (the unmount flush relies on that).
  const inFlight = useRef<Promise<void> | null>(null);

  const flush = useCallback((): Promise<void> => {
    const step = async () => {
      const next = pending.current;
      pending.current = {};
      if (Object.keys(next).length === 0) return;
      setSaveState("saving");
      try {
        // offeringOfficeIds is read-only here — it belongs to B1 and is loaded
        // only so the override panel can offer the right offices. Sending it
        // back would let this hook silently overwrite a B1 edit.
        const writable: Record<string, unknown> = { ...next };
        delete writable.offeringOfficeIds;
        await updateServiceDefinition(definitionId, writable as never);
        setSaveState("saved");
      } catch {
        // Restore the unsent fields; edits made since win per key. No timer is re-armed, so there is
        // no retry storm while the backend is down — the next patch() carries them. (A failed
        // flush-on-unmount has no later patch, so that edit is still lost.)
        pending.current = { ...next, ...pending.current };
        setSaveState("offline");
      }
    };
    const prev = inFlight.current;
    const run: Promise<void> = (prev ? prev.then(step) : step()).then(() => {
      if (inFlight.current === run) inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [definitionId]);

  const patch = useCallback(
    (next: Partial<Phase3Config>) => {
      // Local state updates immediately so typing is never blocked on the round
      // trip; only the write is deferred.
      setConfig((c) => ({ ...c, ...next }));
      pending.current = { ...pending.current, ...next };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void flush(); }, 2000);
    },
    [flush],
  );

  // Flush rather than merely cancel on unmount: a designer who edits a field and
  // immediately clicks Next would otherwise lose the last two seconds of typing.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    void flush();
  }, [flush]);

  return { config, loaded, saveState, setSaveState, patch };
}
