"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import {
  activateDomainPackStage3,
  fetchActivationStageStatus,
  fetchDomainPacksForInstallResult,
  type ActivationJobState,
  type DomainPackActivateResult,
  type DomainPackListItem,
} from "./domainPackApi";
import {
  MUNICIPAL_DOMAIN_PACK_KEY,
  outcomeLabels,
  type DomainPackCatalogEntry,
} from "./domainPackCatalog";

export type DomainPackActivatePanelProps = {
  /** Compact embed on the installer wizard vs full page. */
  variant?: "embedded" | "page";
  /** Pre-select a pack key (defaults to municipal-in-v1). */
  initialPackKey?: string;
  /**
   * GAP-INSTALL-HOME-03 / GAP-INSTALL-DOMAIN-PACKS-01: whether the current
   * session may run Stage 3 activation (tenant provisioning). When false the
   * Activate control is hidden and a read-only note is shown instead. The
   * install-service enforces the same role check server-side; this only
   * decides whether the UI offers the mutation.
   */
  canOperate?: boolean;
  /** How often the activation job is polled (ms). Default 3000. */
  pollIntervalMs?: number;
};

/** Poll the job at most this many times before telling the user it is still running. */
const MAX_JOB_POLLS = 20;

export function DomainPackActivatePanel({
  variant = "page",
  initialPackKey = MUNICIPAL_DOMAIN_PACK_KEY,
  canOperate = true,
  pollIntervalMs = 3000,
}: DomainPackActivatePanelProps) {
  const router = useRouter();
  const [packs, setPacks] = useState<DomainPackListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedKey, setSelectedKey] = useState(initialPackKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DomainPackActivateResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [jobState, setJobState] = useState<ActivationJobState | "slow">("queued");

  // GAP-INSTALL-DOMAIN-PACKS-01: follow the activation job until it completes or
  // fails (bounded; after MAX_JOB_POLLS we say it is still running).
  const stageId = result?.stageId;
  useEffect(() => {
    if (!stageId) return;
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setJobState("queued");
    const tick = async () => {
      const { state } = await fetchActivationStageStatus(stageId);
      if (cancelled) return;
      polls += 1;
      if (state === "completed" || state === "failed") {
        setJobState(state);
        return;
      }
      if (polls >= MAX_JOB_POLLS) {
        setJobState(state === "unknown" ? "unknown" : "slow");
        return;
      }
      setJobState(state);
      timer = setTimeout(() => void tick(), pollIntervalMs);
    };
    timer = setTimeout(() => void tick(), pollIntervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [stageId, pollIntervalMs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { packs: data, error: fetchError } = await fetchDomainPacksForInstallResult();
      if (!cancelled) {
        setPacks(data);
        setLoadError(fetchError);
        setSelectedKey((current) =>
          data.some((p) => p.domainPackKey === current) ? current : (data[0]?.domainPackKey ?? current),
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  const selected = packs.find((p) => p.domainPackKey === selectedKey) ?? packs[0];

  async function doActivate() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const accepted = await activateDomainPackStage3(
        selected.domainPackKey,
        selected.outcomes.map((o) => o.packKey),
      );
      setResult(accepted);
      setConfirmOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not activate Domain Pack.");
    } finally {
      setBusy(false);
    }
  }

  const activated = Boolean(result) && jobState !== "failed";

  return (
    <section
      aria-labelledby="domain-pack-stage3-heading"
      style={{
        border: `1px solid ${variant === "embedded" ? "var(--primary-soft)" : "var(--line)"}`,
        background: variant === "embedded" ? "var(--primary-soft)" : "var(--panel)",
        borderRadius: "var(--r)",
        boxShadow: "var(--sh)",
        padding: variant === "embedded" ? 20 : 24,
        color: "var(--ink)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--primary)", margin: 0 }}>
            Install Stage 3
          </p>
          <h2 id="domain-pack-stage3-heading" style={{ marginTop: 4, fontSize: 18, fontWeight: 600 }}>
            Domain Pack — browse &amp; activate
          </h2>
          <p style={{ marginTop: 4, maxWidth: 672, fontSize: 14, color: "var(--ink2)" }}>
            Choose a Domain Pack to import service drafts for local review. Activating{" "}
            <strong style={{ color: "var(--ink)" }}>Municipal India (ULB)</strong> yields editable{" "}
            <strong style={{ color: "var(--ink)" }}>Trade License</strong>,{" "}
            <strong style={{ color: "var(--ink)" }}>Public Grievance Redressal</strong>, and{" "}
            <strong style={{ color: "var(--ink)" }}>Water Connection</strong> catalogue drafts. Nothing goes
            live until your office publishes.
          </p>
        </div>
        {variant === "embedded" ? (
          <Link href="/install/domain-packs" style={{ fontSize: 14, fontWeight: 600, color: "var(--primary)" }}>
            Open full panel
          </Link>
        ) : (
          <Link href="/install" style={{ fontSize: 14, fontWeight: 600, color: "var(--primary)" }}>
            Installer wizard
          </Link>
        )}
      </div>

      {loading ? (
        <p style={{ marginTop: 16, fontSize: 14, color: "var(--ink2)" }} role="status">
          Loading Domain Packs…
        </p>
      ) : (
        <ul
          style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", listStyle: "none", padding: 0 }}
          aria-label="Domain Pack library"
        >
          {packs.map((pack) => {
            const active = pack.domainPackKey === selected?.domainPackKey;
            return (
              <li key={pack.domainPackKey}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelectedKey(pack.domainPackKey);
                    setResult(null);
                    setError(null);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "start",
                    padding: 16,
                    borderRadius: "var(--r-sm)",
                    border: `${active ? 2 : 1}px solid ${active ? "var(--primary)" : "var(--line)"}`,
                    background: "var(--panel)",
                    color: "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{pack.name}</span>
                    {pack.recommended ? <StatusPill status="recommended" label="Recommended" variant="good" /> : null}
                  </div>
                  <p style={{ marginTop: 8, fontSize: 14, color: "var(--ink2)" }}>{pack.summary}</p>
                  <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "var(--ink2)" }}>
                    Outcome: {outcomeLabels(pack)}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {loadError ? (
        <div style={{ marginTop: 16 }}>
          <Alert
            variant="warning"
            role="alert"
            title="Showing built-in pack only"
            action={
              <Button variant="ghost" size="sm" onClick={() => setReloadNonce((n) => n + 1)}>
                Retry
              </Button>
            }
          >
            The Domain Pack library could not be loaded, so only the built-in municipal pack is shown. Other
            packs may be missing.
          </Alert>
        </div>
      ) : null}

      {selected ? <OutcomePreview pack={selected} /> : null}

      {result ? (
        <div style={{ marginTop: 16 }}>
          <Alert variant={jobState === "failed" ? "danger" : "success"} role="status" title={`Activation accepted (Stage ${result.stageNumber})`}>
            {selected?.name ?? "Domain Pack"} queued. Expected drafts:{" "}
            {result.packKeys.length > 0
              ? result.packKeys.map((k) => k.replace(/^pack:/, "")).join(", ")
              : outcomeLabels(selected!)}
            . Open the{" "}
            <Link href="/designer" style={{ fontWeight: 600, textDecoration: "underline" }}>
              Service Designer
            </Link>{" "}
            to review editable drafts in this session.
            {result.stageId ? <ActivationJobLine state={jobState} /> : null}
          </Alert>
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={{ marginTop: 12, fontSize: 14, color: "var(--bad)" }}>
          {error}
        </p>
      ) : null}

      <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {canOperate ? (
          <Button
            variant="primary"
            className="btn-tall"
            disabled={busy || loading || !selected || activated}
            aria-busy={busy}
            onClick={() => setConfirmOpen(true)}
          >
            {activated ? "Activated" : result ? "Retry activation" : "Activate Domain Pack"}
          </Button>
        ) : (
          <p style={{ fontSize: 14, color: "var(--ink2)" }} role="note">
            You have read-only access. Activating a Domain Pack requires an installer or tenant-admin role.
          </p>
        )}
        {result ? (
          <Link href="/designer" className="btn ghost btn-tall">
            Review drafts
          </Link>
        ) : null}
      </div>

      {canOperate ? (
        <ConfirmDialog
          open={confirmOpen}
          title={`Activate ${selected?.name ?? "Domain Pack"}?`}
          description={
            selected ? (
              <span>
                This runs Install Stage 3 for <strong>{selected.name}</strong> and imports{" "}
                <strong>{outcomeLabels(selected)}</strong> as editable catalogue drafts. Services stay draft
                until published.
              </span>
            ) : undefined
          }
          confirmLabel="Activate"
          cancelLabel="Cancel"
          busy={busy}
          errorMessage={error ?? undefined}
          onConfirm={() => void doActivate()}
          onCancel={() => setConfirmOpen(false)}
        />
      ) : null}
    </section>
  );
}

const TECH_STYLE = { fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--ink2)" } as const;

function OutcomePreview({ pack }: { pack: DomainPackCatalogEntry }) {
  return (
    <div style={{ marginTop: 16, border: "1px solid var(--line)", background: "var(--line2)", borderRadius: "var(--r-sm)", padding: 16 }}>
      <p style={{ fontSize: 14, fontWeight: 600 }}>
        {pack.name}
        {" → "}
        <span>{outcomeLabels(pack)}</span>
        <span style={{ marginInlineStart: 4, fontWeight: 400, color: "var(--ink2)" }}>editable drafts</span>
      </p>
      <ol style={{ marginTop: 12, display: "grid", gap: 8, listStyle: "none", padding: 0 }} aria-label="Service packs imported on activate">
        {pack.outcomes.map((o) => (
          <li
            key={o.packKey}
            style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 8, border: "1px solid var(--line)", background: "var(--panel)", borderRadius: 8, padding: "8px 12px", fontSize: 14 }}
          >
            <span style={{ background: "var(--primary-soft)", color: "var(--primary-d)", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 600 }}>
              {o.shortLabel}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontWeight: 600 }}>{o.label}</p>
              <p style={{ fontSize: 12, color: "var(--ink2)" }}>{o.description}</p>
            </div>
            <span style={{ fontSize: 12, color: "var(--ink2)" }}>draft</span>
          </li>
        ))}
      </ol>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--ink2)" }}>Technical details</summary>
        <p style={{ ...TECH_STYLE, marginTop: 4 }}>{pack.domainPackKey}</p>
        <ul style={{ marginTop: 4, listStyle: "none", padding: 0 }}>
          {pack.outcomes.map((o) => (
            <li key={o.packKey} style={TECH_STYLE}>
              {o.packKey}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ActivationJobLine({ state }: { state: ActivationJobState | "slow" }) {
  const line = { marginTop: 8, display: "block" } as const;
  if (state === "completed") {
    return (
      <strong style={line} data-job-state="completed">
        Activation completed
      </strong>
    );
  }
  if (state === "failed") {
    return (
      <strong style={line} data-job-state="failed">
        Activation failed. The install job reported a problem — check the{" "}
        <Link href="/install/console" style={{ textDecoration: "underline" }}>
          Install console
        </Link>{" "}
        for details, then retry.
      </strong>
    );
  }
  if (state === "slow" || state === "unknown") {
    return (
      <span style={line} data-job-state={state}>
        {state === "unknown"
          ? "We couldn't check the install job's progress. "
          : "Still processing — this is taking longer than usual. "}
        Follow it in the{" "}
        <Link href="/install/console" style={{ textDecoration: "underline" }}>
          Install console
        </Link>
        .
      </span>
    );
  }
  return (
    <span style={line} data-job-state="queued">
      Waiting for the install job to finish…
    </span>
  );
}
