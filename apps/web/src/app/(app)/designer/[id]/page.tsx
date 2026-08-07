"use client";

import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { Card, HelpTip } from "@/app/_components/ds";
import { WizardShell, type DesignerBlock } from "@/app/_components/ds/designer";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../_data/designerLoader";

export default function DesignerWizardPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();

  const patternId = search.get("pattern") ?? "certificate";
  const serviceName = search.get("name") ?? "Untitled service";
  const patternMeta = SERVICE_PATTERN_OPTIONS.find((p) => p.id === patternId);
  const hidden = hiddenBlocksForPattern(patternId);

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b, idx) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status: idx === 0 ? "in-progress" : "empty",
      })),
    [hidden],
  );

  const activeBlock = "b1";

  return (
    <WizardShell
      serviceName={serviceName}
      patternLabel={patternMeta?.title ?? patternId}
      version={1}
      status="draft"
      saveState="saved"
      blocks={blocks}
      activeBlockId={activeBlock}
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}?pattern=${patternId}&name=${encodeURIComponent(serviceName)}`)}
      onNext={() => router.push(`/designer/${params.id}/b2?pattern=${patternId}&name=${encodeURIComponent(serviceName)}`)}
      help={
        <HelpTip label="Catalogue & Identity">
          Set the service name, owning office, channels, and SLA. This is what citizens see in the service list.
        </HelpTip>
      }
    >
      <Card title="B1 — Catalogue & Identity" padding>
        <p style={{ marginTop: 0, color: "var(--ink2)" }}>
          Stub screen — full block editors ship in Phase 1. Draft id: <code>{params.id}</code>
        </p>
        <p style={{ color: "var(--mut)", fontSize: 13 }}>
          Pattern: {patternMeta?.title ?? patternId}. Use the block rail to jump between composition steps.
        </p>
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <Link href="/designer" className="btn ghost">← Library</Link>
          <Link href={`/designer/${params.id}/test?pattern=${patternId}`} className="btn ghost">Run Test</Link>
        </div>
      </Card>
    </WizardShell>
  );
}
