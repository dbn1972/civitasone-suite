"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog, HelpTip } from "@/app/_components/ds";
import { VersionDiff, WizardShell } from "@/app/_components/ds/designer";
import { AccessibilityPreview } from "../../_components/AccessibilityPreview";
import type { ServiceDefinitionDto } from "../../_data/designerApi";
import {
  fetchPublishedByKey,
  publishDefinition,
  rejectDefinition,
} from "../../_data/designerReviewApi";
import { feeSummaryForPublish } from "../../_data/versionDiffModel";
import { useDesignerSession } from "../../_data/useDesignerSession";
import { useDesignerWizard } from "../../_data/useDesignerWizard";
import { DEFAULT_BLOCKS, hiddenBlocksForPattern, SERVICE_PATTERN_OPTIONS } from "../../_data/designerConstants";

export default function DesignerReviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const session = useDesignerSession();
  const wizard = useDesignerWizard(params.id, "review");

  const [published, setPublished] = useState<Record<string, unknown> | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!wizard.def?.serviceKey) return;
    void fetchPublishedByKey(wizard.def.serviceKey).then(setPublished);
  }, [wizard.def?.serviceKey]);

  const isSubmitter = Boolean(
    session?.userId && wizard.meta.submittedBy && session.userId === wizard.meta.submittedBy,
  );
  const isChecker = Boolean(wizard.meta.submittedBy && !isSubmitter);
  const pattern = wizard.meta.pattern;
  const hidden = hiddenBlocksForPattern(pattern);
  const patternMeta = SERVICE_PATTERN_OPTIONS.find((p) => p.id === pattern);

  const readOnlySummary = (def: ServiceDefinitionDto) => (
    <div style={{ display: "grid", gap: 12 }}>
      {DEFAULT_BLOCKS.filter((b) => !hidden.has(b.id)).map((block) => (
        <section
          key={block.id}
          style={{
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
            background: "var(--panel)",
          }}
        >
          <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>{block.shortLabel} — {block.label}</h4>
          <p style={{ margin: 0, fontSize: 13, color: "var(--mut)" }}>
            {blockSummary(def, block.id)}
          </p>
        </section>
      ))}
    </div>
  );

  const handlePublish = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await publishDefinition(params.id);
      router.push("/designer");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (comment?: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await rejectDefinition(params.id, comment ?? "");
      setRejectOpen(false);
      await wizard.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Reject failed.");
    } finally {
      setBusy(false);
    }
  };

  if (wizard.loading) {
    return <p style={{ color: "var(--mut)" }}>Loading review…</p>;
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
    <>
      <WizardShell
        serviceName={wizard.meta.name}
        patternLabel={patternMeta?.title ?? pattern}
        version={wizard.meta.version}
        status={wizard.meta.status}
        saveState="saved"
        blocks={wizard.blocks.map((b) => ({ ...b, status: "complete" }))}
        activeBlockId="review"
        onBlockSelect={(blockId) => router.push(`/designer/${params.id}/${blockId}`)}
        help={
          <HelpTip term="Review mode">
            Department Head approves or rejects submitted services. Maker and checker must be different people.
          </HelpTip>
        }
      >
        <VersionDiff current={wizard.def} published={published} />

        {/* FN-32 — sits above the publish controls on purpose: the approver
            should see what is wrong with the form before deciding, not after. */}
        <div style={{ marginTop: 24 }}>
          <AccessibilityPreview definitionId={params.id} />
        </div>

        <div style={{ marginTop: 24 }}>{readOnlySummary(wizard.def)}</div>

        {!wizard.meta.submittedBy ? (
          <p style={{ marginTop: 24, color: "var(--mut)" }}>
            This draft has not been submitted for approval yet.
          </p>
        ) : isSubmitter ? (
          <p style={{ marginTop: 24, color: "var(--mut)" }}>
            You submitted this service. A different Department Head must approve or reject it — you cannot make the publish decision.
          </p>
        ) : null}

        {actionError ? (
          <p style={{ color: "var(--bad-fg)", marginTop: 16 }} role="alert">{actionError}</p>
        ) : null}
      </WizardShell>

      {isChecker && wizard.meta.submittedBy ? (
        <div
          style={{
            position: "sticky",
            bottom: 0,
            marginTop: -48,
            padding: "12px 16px",
            background: "var(--panel)",
            borderTop: "1px solid var(--line)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            zIndex: 5,
          }}
        >
          <button type="button" className="btn ghost" onClick={() => setRejectOpen(true)} disabled={busy}>
            Reject
          </button>
          <button type="button" className="btn primary" onClick={() => setApproveOpen(true)} disabled={busy}>
            Approve &amp; Publish
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={approveOpen}
        title="Approve and publish?"
        description={
          <p style={{ margin: 0 }}>
            Publish <strong>{wizard.meta.name}</strong> v{wizard.meta.version}?
            {" "}{feeSummaryForPublish(wizard.def)}.
            {" "}Citizens will see this service once published.
          </p>
        }
        confirmLabel="Publish"
        busy={busy}
        errorMessage={actionError ?? undefined}
        onCancel={() => setApproveOpen(false)}
        onConfirm={() => void handlePublish()}
      />

      <ConfirmDialog
        open={rejectOpen}
        title="Reject submission"
        description="Explain what must change before this service can be resubmitted."
        confirmLabel="Reject"
        danger
        requireReason
        reasonLabel="Rejection comment (required)"
        busy={busy}
        errorMessage={actionError ?? undefined}
        onCancel={() => setRejectOpen(false)}
        onConfirm={(reason) => void handleReject(reason)}
      />
    </>
  );
}

function blockSummary(def: ServiceDefinitionDto, blockId: string): string {
  switch (blockId) {
    case "b1":
      return `${def.name} · ${def.channels.join(", ")} · SLA ${def.slaDays ?? "—"} days`;
    case "b2":
      return def.formId ? `Form linked (${def.formId.slice(0, 8)}…)` : "No form linked";
    case "b3":
      return def.eligibilityRuleSetId ? "Eligibility rules configured" : "No eligibility rules";
    case "b4":
      return def.workflowDefinitionId ? "Approval chain configured" : "No workflow linked";
    case "b5":
      return def.feeScheduleId
        ? `${def.feeModel ?? "fee"} model · HOA ${def.hoaCode ?? "—"}`
        : "No fee schedule";
    case "b6":
      return `${def.requiredDocuments?.length ?? 0} document requirement(s)`;
    case "b7":
      return def.issuanceType ?? "Output template configured";
    case "b8":
      return "Notification matrix configured";
    default:
      return "—";
  }
}
