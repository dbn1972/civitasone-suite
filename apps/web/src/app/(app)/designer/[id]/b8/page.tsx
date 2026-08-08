"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import type { NotificationsDesignState } from "@/app/_components/ds/designer/notificationTypes";
import { NotificationsBuilder } from "../../_components/NotificationsBuilder";
import { fetchServiceDefinition, updateServiceDefinition } from "../../_data/designerApi";
import { adjacentBlocks } from "../../_data/designerNavigation";
import {
  mergeOutputsWithNotifications,
  notificationsConfigToUi,
  notificationsUiToConfig,
} from "../../_data/notificationBuilderApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";
import { useDesignerWizard } from "../../_data/useDesignerWizard";

export default function DesignerB8Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const wizard = useDesignerWizard(params.id, "b8");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initialDesign, setInitialDesign] = useState<NotificationsDesignState>(() =>
    notificationsConfigToUi([], "certificate"),
  );
  const outputsRef = useRef<unknown[]>([]);
  const [meta, setMeta] = useState({
    name: "Untitled service",
    serviceKey: "",
    pattern: "certificate",
    version: 1,
    status: "draft",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const def = await fetchServiceDefinition(params.id);
        if (cancelled) return;
        const pattern = def.servicePattern ?? "certificate";
        outputsRef.current = def.outputs ?? [];
        setMeta({
          name: def.name,
          serviceKey: def.serviceKey,
          pattern,
          version: def.version,
          status: def.status,
        });
        setInitialDesign(notificationsConfigToUi(def.outputs, pattern));
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load draft.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params.id]);

  const patternMeta = SERVICE_PATTERN_OPTIONS.find((p) => p.id === wizard.meta.pattern);
  const hidden = hiddenBlocksForPattern(wizard.meta.pattern);
  const { prev, next } = adjacentBlocks(wizard.meta.pattern, "b8");

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status: b.id === "b8" ? "in-progress" : b.id === "b1" || b.id === "b2" ? "complete" : "empty",
      })),
    [hidden],
  );

  const onDesignPersisted = async (design: NotificationsDesignState) => {
    try {
      const outputs = mergeOutputsWithNotifications(outputsRef.current, notificationsUiToConfig(design));
      outputsRef.current = outputs;
      await updateServiceDefinition(params.id, { outputs });
    } catch {
      // best-effort
    }
  };

  if (loading || wizard.loading) {
    return <p style={{ color: "var(--mut)" }}>Loading notifications…</p>;
  }

  if (error || wizard.error) {
    return (
      <div>
        <p style={{ color: "var(--bad-fg)" }}>{error ?? wizard.error}</p>
        <Link href="/designer" className="btn ghost">← Library</Link>
      </div>
    );
  }

  return (
    <WizardShell
      serviceName={meta.name}
      patternLabel={patternMeta?.title ?? wizard.meta.pattern}
      version={meta.version}
      status={meta.status}
      saveState={saveState}
      blocks={wizard.blocks.length ? wizard.blocks : blocks}
      activeBlockId="b8"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onBack={() => router.push(`/designer/${params.id}/${prev}`)}
      onNext={() => router.push(`/designer/${params.id}/${next}`)}
      canRunTest={wizard.canRunTest}
      canSubmit={wizard.canSubmit}
      onRunTest={wizard.onRunTest}
      onSubmit={() => void wizard.onSubmit()}
      submitBusy={wizard.submitting}
      help={
        <HelpTip term="Notifications">
          Set SMS, email, WhatsApp, and in-app messages for each step of the service.
        </HelpTip>
      }
    >
      <NotificationsBuilder
        serviceKey={meta.serviceKey}
        pattern={meta.pattern}
        initial={initialDesign}
        onSaveState={setSaveState}
        onDesignPersisted={onDesignPersisted}
      />
    </WizardShell>
  );
}
