"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import { FeeBuilder } from "../../_components/FeeBuilder";
import { fetchServiceDefinition, updateServiceDefinition } from "../../_data/designerApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";
import { emptyFormDesign, loadFormDesign } from "../../_data/formBuilderApi";
import { emptyFeeDesign, loadFeeDesign } from "../../_data/feeBuilderApi";
import type { FeeDesignState } from "@/app/_components/ds/designer/feeTypes";

export default function DesignerB5Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initialDesign, setInitialDesign] = useState<FeeDesignState>(() => emptyFeeDesign("Untitled service"));
  const [formFields, setFormFields] = useState<FormFieldDefinition[]>([]);
  const [meta, setMeta] = useState({
    name: "Untitled service",
    pattern: "certificate",
    version: 1,
    status: "draft",
    serviceKey: "",
    serviceId: "",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const def = await fetchServiceDefinition(params.id);
        if (cancelled) return;
        const sid = def.serviceId ?? def.id;
        setMeta({
          name: def.name,
          pattern: def.servicePattern ?? "certificate",
          version: def.version,
          status: def.status,
          serviceKey: def.serviceKey,
          serviceId: sid,
        });

        try {
          const form = await loadFormDesign(def.serviceKey, def.name);
          setFormFields(Object.values(form.fields));
        } catch {
          setFormFields([]);
        }

        const design = await loadFeeDesign(sid, def.name, {
          feeModel: def.feeModel,
          feeScheduleId: def.feeScheduleId,
          hoaCode: def.hoaCode,
        });
        setInitialDesign(design);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load draft.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [params.id]);

  const patternMeta = SERVICE_PATTERN_OPTIONS.find((p) => p.id === meta.pattern);
  const hidden = hiddenBlocksForPattern(meta.pattern);
  const prevBlock = hidden.has("b4") ? (hidden.has("b3") ? "b2" : "b3") : "b4";
  const nextBlock = hidden.has("b6") ? "b7" : "b6";

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status:
          b.id === "b5" ? "in-progress"
            : b.id === "b1" || b.id === "b2" ? "complete"
              : b.id === "b3" && !hidden.has("b3") ? "complete"
                : b.id === "b4" && !hidden.has("b4") ? "complete"
                  : "empty",
      })),
    [hidden],
  );

  const onDesignPersisted = async (design: FeeDesignState) => {
    try {
      await updateServiceDefinition(params.id, {
        feeModel: design.feeModel ?? undefined,
        hoaCode: design.hoaCode || undefined,
        feeScheduleId: design.scheduleId,
      });
    } catch {
      // best-effort catalogue linkage
    }
  };

  if (loading) {
    return <p style={{ color: "var(--mut)" }}>Loading fee builder…</p>;
  }

  if (error) {
    return (
      <div>
        <p style={{ color: "var(--bad-fg)" }}>{error}</p>
        <Link href="/designer" className="btn ghost">← Library</Link>
      </div>
    );
  }

  return (
    <WizardShell
      serviceName={meta.name}
      patternLabel={patternMeta?.title ?? meta.pattern}
      version={meta.version}
      status={meta.status}
      saveState={saveState}
      blocks={blocks}
      activeBlockId="b5"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onBack={() => router.push(`/designer/${params.id}/${prevBlock}`)}
      onNext={() => router.push(`/designer/${params.id}/${nextBlock}`)}
      help={
        <HelpTip term="Fee & Revenue">
          Set how much applicants pay, which account receives it, and when the demand is raised.
        </HelpTip>
      }
    >
      <FeeBuilder
        serviceId={meta.serviceId}
        serviceName={meta.name}
        initial={initialDesign}
        formFields={formFields}
        engineAvailable={false}
        onSaveState={setSaveState}
        onDesignPersisted={onDesignPersisted}
      />
      <div style={{ marginTop: 16 }}>
        <Link href={`/designer/${params.id}/${prevBlock}`} className="btn ghost">← Previous block</Link>
      </div>
    </WizardShell>
  );
}
