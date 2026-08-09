"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import type { NotificationsDesignState } from "@/app/_components/ds/designer/notificationTypes";
import { NotificationsBuilder } from "../../_components/NotificationsBuilder";
import { WebhookSubscriptionsBuilder } from "../../_components/WebhookSubscriptionsBuilder";
import { fetchServiceDefinition, updateServiceDefinition } from "../../_data/designerApi";
import { usePhase3Config } from "../../_data/usePhase3Config";
import { adjacentBlocks } from "../../_data/designerNavigation";
import { loadFormDesign } from "../../_data/formBuilderApi";
import {
  mergeOutputsWithNotifications,
  notificationsConfigToUi,
  notificationsUiToConfig,
} from "../../_data/notificationBuilderApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";
import { useDesignerWizard } from "../../_data/useDesignerWizard";

export default function DesignerB8Page() {
  const params = useParams<{ id: string }>();
  // FN-30 — outbound webhooks are notifications to other agencies.
  const phase3 = usePhase3Config(params.id);
  const router = useRouter();
  const wizard = useDesignerWizard(params.id, "b8");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initialDesign, setInitialDesign] = useState<NotificationsDesignState>(() =>
    notificationsConfigToUi([], "certificate"),
  );
  const [formFields, setFormFields] = useState<FormFieldDefinition[]>([]);
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

        try {
          const form = await loadFormDesign(def.serviceKey, def.name);
          if (!cancelled) setFormFields(Object.values(form.fields));
        } catch {
          if (!cancelled) setFormFields([]);
        }
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
          Set SMS, email, WhatsApp, and in-app messages for each step. Preview uses the same FormRenderer
          sample answers as Apply so merge fields stay honest.
        </HelpTip>
      }
    >
      <NotificationsBuilder
        serviceKey={meta.serviceKey}
        serviceName={meta.name}
        pattern={meta.pattern}
        formFields={formFields}
        initial={initialDesign}
        onSaveState={setSaveState}
        onDesignPersisted={onDesignPersisted}
      />
      <div style={{ marginTop: 24 }}>
        <WebhookSubscriptionsBuilder
          value={phase3.config.webhookSubscriptions as never}
          onChange={(webhookSubscriptions) => void phase3.patch({ webhookSubscriptions })}
        />
      </div>
    </WizardShell>
  );
}
