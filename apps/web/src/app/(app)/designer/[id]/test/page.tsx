"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { TestRunPanel, WizardShell, type DesignerBlock, type TestRunStep } from "@/app/_components/ds/designer";
import { fetchServiceDefinition } from "../../_data/designerApi";
import { adjacentBlocks } from "../../_data/designerNavigation";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";

const DEFAULT_STEPS: TestRunStep[] = [
  { id: "form", label: "Intake form validates", status: "pending" },
  { id: "eligibility", label: "Eligibility rules", status: "pending" },
  { id: "workflow", label: "Approval chain lanes", status: "pending" },
  { id: "demand", label: "Fee demand lines", status: "pending" },
  { id: "payment", label: "Sandbox payment", status: "pending" },
  { id: "gl", label: "GL journal entry", status: "pending" },
  { id: "certificate", label: "Certificate issuance", status: "pending" },
];

export default function DesignerTestPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState] = useState<"saving" | "saved" | "offline">("saved");
  const [steps, setSteps] = useState<TestRunStep[]>(DEFAULT_STEPS);
  const [running, setRunning] = useState(false);
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
  const { prev } = adjacentBlocks(meta.pattern, "b8");

  const blocks: DesignerBlock[] = useMemo(
    () =>
      DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status: "empty",
      })),
    [hidden],
  );

  const runTest = async () => {
    setRunning(true);
    setSteps(DEFAULT_STEPS.map((s) => ({ ...s, status: "running" as const })));
    await new Promise((r) => setTimeout(r, 800));
    setSteps(DEFAULT_STEPS.map((s, i) => ({
      ...s,
      status: i < 3 ? "pass" : "pending",
      error: undefined,
    })));
    setRunning(false);
  };

  if (loading) {
    return <p style={{ color: "var(--mut)" }}>Loading test panel…</p>;
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
      activeBlockId="b8"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onBack={() => router.push(`/designer/${params.id}/${prev}`)}
      canRunTest
      help={
        <HelpTip term="Sandbox test">
          Run a full pipeline check before submitting for approval.
        </HelpTip>
      }
    >
      <TestRunPanel steps={steps} onRun={() => void runTest()} running={running} />
    </WizardShell>
  );
}
