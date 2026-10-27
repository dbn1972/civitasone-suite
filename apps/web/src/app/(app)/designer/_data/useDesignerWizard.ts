"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignerBlock } from "@/app/_components/ds/designer";
import { fetchServiceDefinition, type ServiceDefinitionDto } from "./designerApi";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "./designerConstants";
import { fetchLatestSandboxTest } from "./sandboxTestApi";
import { submitForApproval } from "./designerReviewApi";
import { adjacentBlocks } from "./designerNavigation";
import { collectDesignIssues, countIssuesByBlock } from "./designerGating";
import { toHumanError } from "@/lib/messages";
import { isNetworkFailure } from "@/lib/userFacingError";

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

/**
 * Owner decision D4c #11 (GAP-DESIGNER-DETAIL-B8-03): blocks 1 to 7 must be
 * complete before the officer can run the test; block 8 (outputs, notifications)
 * may stay optional. Returns the blocks holding Run Test back, in rail order, so
 * the footer can say which one to finish.
 */
export const OPTIONAL_FOR_RUN_TEST = new Set(["b8"]);

export function blocksHoldingRunTest(blocks: DesignerBlock[]): DesignerBlock[] {
  return blocks.filter((b) => !b.hidden && !OPTIONAL_FOR_RUN_TEST.has(b.id) && b.status !== "complete");
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
    // A pass only counts for the design it tested: the server flags a run whose
    // design hash no longer matches the draft (it also rejects submit with
    // TEST_STALE), so the Submit button must not light up on a stale pass.
    setTestPassed(latest.status === "pass" && latest.stale !== true);
    return next;
  }, [definitionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) {
          if (isNetworkFailure(e)) {
            const human = toHumanError("load", { area: "draft" });
            setError(`${human.what} ${human.next}`);
          } else {
            setError(e instanceof Error ? e.message : "Could not load draft.");
          }
        }
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
    const counts = countIssuesByBlock(collectDesignIssues(def, hidden));
    return DEFAULT_BLOCKS.map((b) => ({
      id: b.id,
      shortLabel: b.shortLabel,
      label: b.label,
      hidden: hidden.has(b.id),
      status: blockStatusForDef(def, b.id, hidden),
      blockingCount: counts[b.id]?.blocking ?? 0,
      warningCount: counts[b.id]?.warning ?? 0,
    }));
  }, [def, hidden]);
  const issues = useMemo(() => (def ? collectDesignIssues(def, hidden) : []), [def, hidden]);

  const { prev, next } = adjacentBlocks(pattern, activeBlockId);
  const runTestBlockedBy = useMemo(() => blocksHoldingRunTest(blocks).map((b) => b.label), [blocks]);
  const canRunTest = runTestBlockedBy.length === 0;
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
      if (isNetworkFailure(e)) {
        const human = toHumanError("save", { area: "submission" });
        setError(`${human.what} ${human.next}`);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        const human = toHumanError("save", { area: "submission" });
        setError(`${human.what} ${human.next}`);
      }
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
    issues,
    canRunTest,
    runTestBlockedBy,
    canSubmit,
    testPassed,
    submitting,
    onRunTest,
    onSubmit,
    reload,
  };
}
