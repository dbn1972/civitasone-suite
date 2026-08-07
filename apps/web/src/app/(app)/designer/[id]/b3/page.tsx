"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import { EligibilityBuilder } from "../../_components/EligibilityBuilder";
import { fetchServiceDefinition, updateServiceDefinition } from "../../_data/designerApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";
import { emptyEligibilityDesign, loadEligibilityDesign } from "../../_data/eligibilityBuilderApi";
import { emptyFormDesign, loadFormDesign } from "../../_data/formBuilderApi";

export default function DesignerB3Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initialDesign, setInitialDesign] = useState(emptyEligibilityDesign("Untitled service"));
  const [formFields, setFormFields] = useState<FormFieldDefinition[]>([]);
  const [meta, setMeta] = useState({
    name: "Untitled service",
    pattern: "certificate",
    version: 1,
    status: "draft",
    serviceKey: "",
    eligibilityRuleSetId: null as string | null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const def = await fetchServiceDefinition(params.id);
        if (cancelled) return;
        setMeta({
          name: def.name,
          pattern: def.servicePattern ?? "certificate",
          version: def.version,
          status: def.status,
          serviceKey: def.serviceKey,
          eligibilityRuleSetId: def.eligibilityRuleSetId ?? null,
        });

        let fields: FormFieldDefinition[] = [];
        try {
          const form = await loadFormDesign(def.serviceKey, def.name);
          fields = Object.values(form.fields);
        } catch {
          fields = [];
        }
        setFormFields(fields);

        const design = await loadEligibilityDesign(
          def.serviceId ?? def.id,
          def.name,
          def.eligibilityRuleSetId,
        );
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

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status:
          b.id === "b3" ? "in-progress"
            : b.id === "b1" || b.id === "b2" ? "complete"
              : "empty",
      })),
    [hidden],
  );

  const onDesignPersisted = async (design: typeof initialDesign) => {
    if (!design.ruleSetId) return;
    try {
      await updateServiceDefinition(params.id, { eligibilityRuleSetId: design.ruleSetId });
    } catch {
      // best-effort catalogue linkage
    }
  };

  if (loading) {
    return <p style={{ color: "var(--mut)" }}>Loading eligibility builder…</p>;
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
      activeBlockId="b3"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onBack={() => router.push(`/designer/${params.id}/b2`)}
      onNext={() => router.push(`/designer/${params.id}/b4`)}
      help={
        <HelpTip term="Eligibility">
          Optional gates before the approval chain. Block, warn, or flag applicants based on profile or form answers.
        </HelpTip>
      }
    >
      <EligibilityBuilder
        serviceId={params.id}
        serviceName={meta.name}
        initial={initialDesign}
        formFields={formFields}
        onSaveState={setSaveState}
        onDesignPersisted={onDesignPersisted}
      />
      <div style={{ marginTop: 16 }}>
        <Link href={`/designer/${params.id}/b2`} className="btn ghost">← Intake Form</Link>
      </div>
    </WizardShell>
  );
}
