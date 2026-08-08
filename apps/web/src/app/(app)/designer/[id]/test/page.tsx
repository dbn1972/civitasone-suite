"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { HelpTip } from "@/app/_components/ds";
import { TestRunPanel, WizardShell, type TestRunStep } from "@/app/_components/ds/designer";
import {
  fetchSandboxTestHistory,
  runSandboxTest,
  type SandboxRunHistoryRow,
} from "../../_data/sandboxTestApi";
import { useDesignerWizard } from "../../_data/useDesignerWizard";

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
  const wizard = useDesignerWizard(params.id, "test");

  const [steps, setSteps] = useState<TestRunStep[]>(DEFAULT_STEPS);
  const [history, setHistory] = useState<SandboxRunHistoryRow[]>([]);
  const [running, setRunning] = useState(false);

  const loadHistory = useCallback(async () => {
    setHistory(await fetchSandboxTestHistory(params.id));
  }, [params.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const runTest = async () => {
    setRunning(true);
    setSteps(DEFAULT_STEPS.map((s) => ({ ...s, status: "running" as const })));
    try {
      const result = await runSandboxTest(params.id);
      setSteps(result.steps ?? DEFAULT_STEPS);
      await wizard.reload();
      await loadHistory();
    } catch (e) {
      setSteps(DEFAULT_STEPS.map((s) => ({
        ...s,
        status: "fail" as const,
        error: e instanceof Error ? e.message : "Test run failed.",
      })));
    } finally {
      setRunning(false);
    }
  };

  if (wizard.loading) {
    return <p style={{ color: "var(--mut)" }}>Loading test panel…</p>;
  }

  if (wizard.error || !wizard.def) {
    return (
      <div>
        <p style={{ color: "var(--bad-fg)" }}>{wizard.error ?? "Draft not found."}</p>
        <Link href="/designer" className="btn ghost">← Library</Link>
      </div>
    );
  }

  return (
    <WizardShell
      serviceName={wizard.meta.name}
      patternLabel={wizard.meta.patternLabel}
      version={wizard.meta.version}
      status={wizard.meta.status}
      saveState={wizard.saveState}
      blocks={wizard.blocks}
      activeBlockId="test"
      onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
      onBack={() => router.push(`/designer/${params.id}/${wizard.prev}`)}
      canRunTest={wizard.canRunTest}
      canSubmit={wizard.canSubmit}
      onRunTest={() => void runTest()}
      onSubmit={() => void wizard.onSubmit()}
      submitBusy={wizard.submitting}
      help={
        <HelpTip term="Sandbox test">
          Run a full pipeline check before submitting for approval.
        </HelpTip>
      }
    >
      <TestRunPanel
        definitionId={params.id}
        steps={steps}
        history={history}
        onRun={() => void runTest()}
        running={running}
      />
    </WizardShell>
  );
}
