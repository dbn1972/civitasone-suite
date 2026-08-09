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
 * designer who saw their text appear and then vanish would retype it, and the
 * PATCH is idempotent so the next successful save carries it.
 */

import { useCallback, useEffect, useState } from "react";
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

  const patch = useCallback(
    async (next: Partial<Phase3Config>) => {
      setConfig((c) => ({ ...c, ...next }));
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
        setSaveState("offline");
      }
    },
    [definitionId],
  );

  return { config, loaded, saveState, setSaveState, patch };
}
