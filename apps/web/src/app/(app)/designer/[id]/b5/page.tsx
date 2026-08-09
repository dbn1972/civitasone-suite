"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import { FeeBuilder } from "../../_components/FeeBuilder";
import { OfficeOverridesBuilder } from "../../_components/OfficeOverridesBuilder";
import { fetchServiceDefinition, updateServiceDefinition } from "../../_data/designerApi";
import { usePhase3Config } from "../../_data/usePhase3Config";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";
import { loadFormDesign } from "../../_data/formBuilderApi";
import { adjacentBlocks } from "../../_data/designerNavigation";
import { emptyFeeDesign, loadFeeDesign } from "../../_data/feeBuilderApi";
import { hoaBlockMessage, isHoaBlocking } from "../../_data/feeBuilderModel";
import type { FeeDesignState } from "@/app/_components/ds/designer/feeTypes";

export default function DesignerB5Page() {
  const params = useParams<{ id: string }>();
  // FN-22 — per-office fee/SLA variants sit with Fee & Revenue.
  const phase3 = usePhase3Config(params.id);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initialDesign, setInitialDesign] = useState<FeeDesignState>(() => emptyFeeDesign("Untitled service"));
  const [liveDesign, setLiveDesign] = useState<FeeDesignState>(() => emptyFeeDesign("Untitled service"));
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
        setLiveDesign(design);
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
  const { prev, next } = adjacentBlocks(meta.pattern, "b5");
  const hoaBlocked = isHoaBlocking(liveDesign);
  const hoaGate = hoaBlockMessage(liveDesign);

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status:
          b.id === "b5"
            ? (liveDesign.feeModel && liveDesign.hoaCode ? "complete" : liveDesign.feeModel ? "in-progress" : "empty")
            : b.id === "b1" || b.id === "b2" ? "complete"
              : b.id === "b3" && !hidden.has("b3") ? "complete"
                : b.id === "b4" && !hidden.has("b4") ? "complete"
                  : "empty",
      })),
    [hidden, liveDesign.feeModel, liveDesign.hoaCode],
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
      onBack={() => router.push(`/designer/${params.id}/${prev}`)}
      onNext={hoaBlocked ? undefined : () => router.push(`/designer/${params.id}/${next}`)}
      help={
        <HelpTip term="Fee & Revenue">
          Set how much applicants pay, which account receives it, and when the demand is raised.
          Head of Account is required before you can continue.
        </HelpTip>
      }
    >
      {hoaBlocked ? (
        <p
          role="status"
          style={{
            margin: "0 0 12px",
            padding: "8px 12px",
            fontSize: 13,
            color: "var(--bad-fg)",
            background: "var(--bad-bg, #fdecea)",
            borderRadius: "var(--r-sm)",
            border: "1px solid var(--bad-fg)",
          }}
        >
          {hoaGate} Next is disabled until HOA is attached.
        </p>
      ) : null}
      <FeeBuilder
        serviceId={meta.serviceId}
        serviceName={meta.name}
        initial={initialDesign}
        formFields={formFields}
        engineAvailable={false}
        onSaveState={setSaveState}
        onDesignPersisted={onDesignPersisted}
        onDesignChange={setLiveDesign}
      />
      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Link href={`/designer/${params.id}/${prev}`} className="btn ghost">← Previous block</Link>
        {hoaBlocked ? (
          <button type="button" className="btn primary" disabled title={hoaGate ?? undefined}>
            Next blocked — attach HOA
          </button>
        ) : (
          <Link href={`/designer/${params.id}/${next}`} className="btn primary">Next block →</Link>
        )}
      </div>
      <div style={{ marginTop: 24 }}>
        <OfficeOverridesBuilder
          value={phase3.config.officeOverrides as never}
          offeringOfficeIds={phase3.config.offeringOfficeIds}
          onChange={(officeOverrides) => void phase3.patch({ officeOverrides })}
        />
      </div>
    </WizardShell>
  );
}
