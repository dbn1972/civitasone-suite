"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock, type FormDesignState } from "@/app/_components/ds/designer";
import { FormBuilder } from "../../_components/FormBuilder";
import { fetchServiceDefinition, updateServiceDefinition } from "../../_data/designerApi";
import { emptyFormDesign, loadFormDesign } from "../../_data/formBuilderApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";

export default function DesignerB2Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initialDesign, setInitialDesign] = useState<FormDesignState | null>(null);
  const [meta, setMeta] = useState({ name: "Untitled service", pattern: "certificate", version: 1, status: "draft", serviceKey: "" });

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
        });
        let design = emptyFormDesign();
        try {
          design = await loadFormDesign(def.serviceKey, def.name);
        } catch {
          design = emptyFormDesign();
        }
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
        status: b.id === "b2" ? "in-progress" : b.id === "b1" ? "complete" : "empty",
      })),
    [hidden],
  );

  const onDesignPersisted = async (design: FormDesignState) => {
    if (!design.layoutId) return;
    try {
      await updateServiceDefinition(params.id, {
        formId: design.layoutId,
        forms: [{ layoutId: design.layoutId, entityId: design.entityId, formVersionId: design.formVersionId }],
      });
    } catch {
      // best-effort catalogue linkage
    }
  };

  if (loading) {
    return <p style={{ color: "var(--mut)" }}>Loading form builder…</p>;
  }

  if (error || !initialDesign) {
    return (
      <div>
        <p style={{ color: "var(--bad-fg)" }}>{error ?? "Draft not found."}</p>
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
      activeBlockId="b2"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onBack={() => router.push(`/designer/${params.id}/b1`)}
      onNext={() => router.push(`/designer/${params.id}/b3`)}
      help={
        <HelpTip term="Intake Form">
          Build applicant questions here. Preview uses the shared runtime renderer. Changes autosave to metadata-service.
        </HelpTip>
      }
    >
      <FormBuilder
        serviceKey={meta.serviceKey}
        serviceName={meta.name}
        initial={initialDesign}
        onSaveState={setSaveState}
        onDesignPersisted={onDesignPersisted}
      />
      <div style={{ marginTop: 16 }}>
        <Link href={`/designer/${params.id}/b1`} className="btn ghost">← Catalogue</Link>
      </div>
    </WizardShell>
  );
}
