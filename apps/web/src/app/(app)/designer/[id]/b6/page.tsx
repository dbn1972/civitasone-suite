"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import { DocumentsBuilder, documentsUiToApi } from "../../_components/DocumentsBuilder";
import { fetchServiceDefinition, updateServiceDefinition } from "../../_data/designerApi";
import { adjacentBlocks } from "../../_data/designerNavigation";
import { loadDocumentsDesign } from "../../_data/documentBuilderApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";
import { emptyWorkflowDesign, loadWorkflowDesign } from "../../_data/workflowBuilderApi";
import type { DocumentsDesignState } from "@/app/_components/ds/designer/documentTypes";

export default function DesignerB6Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "offline">("saved");
  const [initialDesign, setInitialDesign] = useState<DocumentsDesignState>({ documents: [] });
  const [lanes, setLanes] = useState(emptyWorkflowDesign("").lanes);
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
        const docs = await loadDocumentsDesign(def.requiredDocuments);
        setInitialDesign(docs);
        const workflow = await loadWorkflowDesign(def.name, def.workflowDefinitionId);
        setLanes(workflow.lanes);
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
  const { prev, next } = adjacentBlocks(meta.pattern, "b6");

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status:
          b.id === "b6" ? "in-progress"
            : b.id === "b1" || b.id === "b2" ? "complete"
              : "empty",
      })),
    [hidden],
  );

  const onDesignPersisted = async (design: DocumentsDesignState) => {
    try {
      await updateServiceDefinition(params.id, {
        requiredDocuments: documentsUiToApi(design.documents),
      });
    } catch {
      // best-effort
    }
  };

  if (loading) {
    return <p style={{ color: "var(--mut)" }}>Loading documents…</p>;
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
      activeBlockId="b6"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onBack={() => router.push(`/designer/${params.id}/${prev}`)}
      onNext={() => router.push(`/designer/${params.id}/${next}`)}
      help={
        <HelpTip term="Documents">
          List what applicants must upload and which approval step verifies each document.
        </HelpTip>
      }
    >
      <DocumentsBuilder
        initial={initialDesign}
        lanes={lanes}
        onSaveState={setSaveState}
        onDesignPersisted={onDesignPersisted}
      />
    </WizardShell>
  );
}
