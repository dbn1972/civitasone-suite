"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import type { FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";
import type { IssuanceDesignState } from "@/app/_components/ds/designer/issuanceTypes";
import { OutputIssuanceBuilder } from "../../_components/OutputIssuanceBuilder";
import { fetchServiceDefinition, updateServiceDefinition } from "../../_data/designerApi";
import { adjacentBlocks } from "../../_data/designerNavigation";
import { loadFormDesign } from "../../_data/formBuilderApi";
import {
  issuanceOutputToUi,
  issuanceUiToOutput,
  mergeOutputsWithIssuance,
} from "../../_data/issuanceBuilderApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";

export default function DesignerB7Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initialDesign, setInitialDesign] = useState<IssuanceDesignState>(() =>
    issuanceOutputToUi([], "certificate"),
  );
  const [formFields, setFormFields] = useState<FormFieldDefinition[]>([]);
  const outputsRef = useRef<unknown[]>([]);
  const [meta, setMeta] = useState({
    name: "Untitled service",
    pattern: "certificate",
    version: 1,
    status: "draft",
    serviceKey: "",
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
          pattern,
          version: def.version,
          status: def.status,
          serviceKey: def.serviceKey,
        });
        setInitialDesign(issuanceOutputToUi(def.outputs, pattern, def.issuanceType));

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

  const patternMeta = SERVICE_PATTERN_OPTIONS.find((p) => p.id === meta.pattern);
  const hidden = hiddenBlocksForPattern(meta.pattern);
  const { prev, next } = adjacentBlocks(meta.pattern, "b7");

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status:
          b.id === "b7" ? "in-progress"
            : b.id === "b1" || b.id === "b2" ? "complete"
              : "empty",
      })),
    [hidden],
  );

  const onDesignPersisted = async (design: IssuanceDesignState) => {
    try {
      const outputs = mergeOutputsWithIssuance(outputsRef.current, issuanceUiToOutput(design));
      outputsRef.current = outputs;
      await updateServiceDefinition(params.id, {
        issuanceType: design.outputType,
        outputs,
      });
    } catch {
      // best-effort autosave — footer shows offline via onSaveState
    }
  };

  if (loading) {
    return <p style={{ color: "var(--mut)" }}>Loading output & issuance…</p>;
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
      activeBlockId="b7"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onBack={() => router.push(`/designer/${params.id}/${prev}`)}
      onNext={() => router.push(`/designer/${params.id}/${next}`)}
      help={
        <HelpTip term="Output & Issuance">
          Design the certificate or closure note, numbering format, signatory, and validity period.
        </HelpTip>
      }
    >
      <OutputIssuanceBuilder
        serviceName={meta.name}
        pattern={meta.pattern}
        formFields={formFields}
        initial={initialDesign}
        onSaveState={setSaveState}
        onDesignPersisted={onDesignPersisted}
      />
    </WizardShell>
  );
}
