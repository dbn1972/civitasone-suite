"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignerBlock } from "@/app/_components/ds/designer";
import { fetchServiceDefinition, type ServiceDefinitionDto } from "./designerApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "./designerConstants";
import { fetchLatestSandboxTest } from "./sandboxTestApi";
import { submitForApproval } from "./designerReviewApi";
import { adjacentBlocks } from "./designerNavigation";

function blockStatusForDef(def: ServiceDefinitionDto, blockId: string, hidden: Set<string>): DesignerBlock["status"] {
  if (hidden.has(blockId)) return "empty";
  switch (blockId) {
    case "b1":
      return def.name && def.channels?.length ? "complete" : "in-progress";
    case "b2":
      return def.formId || (Array.isArray(def.forms) && def.forms.length > 0) ? "complete" : "empty";
    case "b3":
      return def.eligibilityRuleSetId ? "complete" : "empty";
    case "b4":
      return def.workflowDefinitionId ? "complete" : "empty";
    case "b5":
      return def.feeScheduleId && def.hoaCode ? "complete" : def.feeScheduleId || def.feeModel ? "in-progress" : "empty";
    case "b6":
      return Array.isArray(def.requiredDocuments) && def.requiredDocuments.length > 0 ? "complete" : "empty";
    case "b7":
      return def.issuanceType || (Array.isArray(def.outputs) && def.outputs.length > 0) ? "complete" : "empty";
    case "b8":
      return "in-progress";
    default:
      return "empty";
  }
}

function blocksCompleteEnough(blocks: DesignerBlock[]): boolean {
  return blocks.filter((b) => !b.hidden).every((b) => b.status === "complete" || b.status === "in-progress");
}

export function useDesignerWizard(definitionId: string, activeBlockId: string) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState] = useState<"saving" | "saved" | "offline">("saved");
  const [def, setDef] = useState<ServiceDefinitionDto | null>(null);
  const [testPassed, setTestPassed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    const next = await fetchServiceDefinition(definitionId);
    setDef(next);
    const latest = await fetchLatestSandboxTest(definitionId);
    setTestPassed(latest.status === "pass");
    return next;
  }, [definitionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load draft.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const pattern = def?.servicePattern ?? "certificate";
  const hidden = hiddenBlocksForPattern(pattern);
  const patternMeta = SERVICE_PATTERN_OPTIONS.find((p) => p.id === pattern);

  const blocks: DesignerBlock[] = useMemo(() => {
    if (!def) {
      return DEFAULT_BLOCKS.map((b) => ({
        id: b.id,
        shortLabel: b.shortLabel,
        label: b.label,
        hidden: hidden.has(b.id),
        status: "empty" as const,
      }));
    }
    return DEFAULT_BLOCKS.map((b) => ({
      id: b.id,
      shortLabel: b.shortLabel,
      label: b.label,
      hidden: hidden.has(b.id),
      status: blockStatusForDef(def, b.id, hidden),
    }));
  }, [def, hidden]);

  const { prev, next } = adjacentBlocks(pattern, activeBlockId);
  const canRunTest = blocksCompleteEnough(blocks);
  const canSubmit = canRunTest && testPassed && def?.status === "draft" && !def?.submittedBy;

  const onRunTest = useCallback(() => {
    router.push(`/designer/${definitionId}/test`);
  }, [router, definitionId]);

  const onSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      await submitForApproval(definitionId);
      await reload();
      router.push(`/designer/${definitionId}/review`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  }, [definitionId, reload, router]);

  return {
    loading,
    error,
    saveState,
    def,
    meta: {
      name: def?.name ?? "Untitled service",
      pattern,
      patternLabel: patternMeta?.title ?? pattern,
      version: def?.version ?? 1,
      status: def?.status ?? "draft",
      submittedBy: def?.submittedBy ?? null,
      serviceKey: def?.serviceKey ?? "",
    },
    blocks,
    prev,
    next,
    canRunTest,
    canSubmit,
    testPassed,
    submitting,
    onRunTest,
    onSubmit,
    reload,
  };
}
