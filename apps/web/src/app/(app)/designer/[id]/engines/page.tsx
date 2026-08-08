"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import type { EngineBindingUi } from "@/app/_components/ds/designer/engineBindingTypes";
import { EngineBindingBuilder } from "../../_components/EngineBindingBuilder";
import { fetchServiceDefinition } from "../../_data/designerApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";
import { normalizeBindingsFromApi } from "../../_data/engineBindingApi";
import { adjacentBlocks } from "../../_data/designerNavigation";

/**
 * FN-21 — Engine Binding Configuration.
 * Kept off FeeBuilder / b5 page files to avoid colliding with Phase 1 B5 PRs.
 * Fee block rail stays active; this is the binding surface for engine fee models.
 */
export default function DesignerEnginesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initial, setInitial] = useState<EngineBindingUi[]>([]);
  const [meta, setMeta] = useState({
    name: "Untitled service",
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
        setMeta({
          name: def.name,
          pattern: def.servicePattern ?? "certificate",
          version: def.version,
          status: def.status,
        });
        setInitial(normalizeBindingsFromApi(def.engineBindings));
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
  const defaultBlock = meta.pattern === "collection" ? "fee" as const : "fee" as const;

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status:
          b.id === "b5" ? "in-progress"
            : b.id === "b1" ? "complete"
              : "empty",
      })),
    [hidden],
  );

  if (loading) {
    return <p style={{ color: "var(--mut)" }}>Loading engine bindings…</p>;
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
      onNext={() => router.push(`/designer/${params.id}/${next}`)}
      help={
        <HelpTip term="Engine Binding">
          Connect Fee / Assessment to an engineered backend. Studio edits exemptions,
          penalty or rebate windows, and HOA — not the assessment formula itself.
        </HelpTip>
      }
    >
      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <Link href={`/designer/${params.id}/b5`} className="btn ghost">← Fee model builder</Link>
        <span style={{ margin: "0 8px", color: "var(--mut)" }}>·</span>
        <span style={{ color: "var(--mut)" }}>Engine binding (FN-21)</span>
      </div>
      <EngineBindingBuilder
        definitionId={params.id}
        initial={initial}
        defaultBlock={defaultBlock}
        onSaveState={setSaveState}
      />
    </WizardShell>
  );
}
