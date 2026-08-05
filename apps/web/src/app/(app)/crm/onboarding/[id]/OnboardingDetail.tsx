"use client";
/**
 * OnboardingDetail — P1-9. Loads a case, shows its fields, and drives the two
 * governed actions:
 *   • KYC panel — records a KYC outcome (only the legal next statuses are
 *     offered; verified/rejected need an approver role, enforced by the BE 403).
 *   • Stage transition — offers ONLY the stages the state machine allows from
 *     the current stage. A KYC-gated stage (completion) whose gate is not
 *     satisfied is shown but DISABLED with the reason, so the clerk sees why
 *     it is unavailable. Cancelling requires a reason (≥10 chars) captured in
 *     the ConfirmDialog. Every advance is confirmed before it is sent, and any
 *     backend 422 (illegal transition / KYC gate / version conflict) is
 *     surfaced verbatim — never swallowed. After a mutation the case reloads.
 *
 * Read is gated on source==="error": a failed load renders the saved-info badge
 * and an explicit message, never a fabricated blank case as fact.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { ConfirmDialog, EmptyState } from "../../../../_components/ds";
import {
  advanceStage,
  recordKyc,
  getOnboardingCase,
  allowedNextKycStatuses,
  nextStageOptions,
  isOnboardingStage,
  isKycStatus,
  STAGE_META,
  KYC_META,
  KYC_LABELS,
  STAGE_LABELS,
  stageLabel,
  kycLabel,
  isTerminalStage,
  CANCELLATION_REASON_MIN_LENGTH,
  isValidCancellationReason,
  type OnboardingCase,
  type OnboardingStage,
  type KycStatus,
  type NextStageOption,
  type OnbSource,
} from "@/lib/crm/onboarding";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN");
}

const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;

export function OnboardingDetail({ id }: { id: string }) {
  const [item, setItem] = useState<OnboardingCase | null>(null);
  const [source, setSource] = useState<OnbSource | "loading">("loading");

  // KYC panel state.
  const [kycTarget, setKycTarget] = useState<KycStatus | "">("");
  const [kycConfirm, setKycConfirm] = useState(false);
  const [kycBusy, setKycBusy] = useState(false);
  const [kycError, setKycError] = useState("");
  const [kycMessage, setKycMessage] = useState("");

  // Stage panel state.
  const [stageTarget, setStageTarget] = useState<OnboardingStage | "">("");
  const [stageConfirm, setStageConfirm] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState("");
  const [stageMessage, setStageMessage] = useState("");

  const kycId = useId();
  const stageId = useId();

  // A single signal tied to the component's mounted lifetime. `reload` (run after
  // a mutation) passes this so setItem/setSource can't fire once we've unmounted.
  const mountedRef = useRef<{ alive: boolean }>({ alive: true });
  useEffect(() => {
    mountedRef.current = { alive: true };
    return () => {
      mountedRef.current.alive = false;
    };
  }, []);

  const load = useCallback(
    (signal?: { alive: boolean }) => {
      setSource("loading");
      return getOnboardingCase(id).then(({ data, source: s }) => {
        if (signal && !signal.alive) return;
        setItem(data);
        setSource(s);
      });
    },
    [id],
  );

  useEffect(() => {
    const signal = { alive: true };
    void load(signal);
    return () => {
      signal.alive = false;
    };
  }, [load]);

  const reload = useCallback(() => {
    void load(mountedRef.current);
  }, [load]);

  const isError = source === "error";
  const isLoading = source === "loading";

  // ---- KYC ----
  const kycStatus: KycStatus | null =
    item && isKycStatus(item.kycStatus) ? item.kycStatus : null;
  const kycNextOptions = kycStatus ? allowedNextKycStatuses(kycStatus) : [];

  const beginKyc = useCallback(() => {
    setKycError("");
    setKycMessage("");
    if (!kycTarget) {
      setKycError("Choose a KYC outcome to record.");
      return;
    }
    setKycConfirm(true);
  }, [kycTarget]);

  const applyKyc = useCallback(async () => {
    if (!item || !kycTarget) return;
    setKycBusy(true);
    setKycError("");
    try {
      const result = await recordKyc(item.id, { status: kycTarget, version: item.version });
      setKycMessage(
        result.accepted
          ? "KYC outcome submitted — it may take a moment to take effect."
          : `KYC recorded as "${KYC_LABELS[kycTarget]}".`,
      );
      setKycConfirm(false);
      setKycTarget("");
      reload();
    } catch (e) {
      setKycError(e instanceof Error ? e.message : "Could not record the KYC outcome.");
    } finally {
      setKycBusy(false);
    }
  }, [item, kycTarget, reload]);

  // ---- Stage ----
  const stage: OnboardingStage | null =
    item && isOnboardingStage(item.stage) ? item.stage : null;
  const stageOptions: NextStageOption[] =
    stage && kycStatus ? nextStageOptions(stage, kycStatus) : [];
  const selectedOption = stageOptions.find((o) => o.stage === stageTarget) ?? null;

  const beginStage = useCallback(() => {
    setStageError("");
    setStageMessage("");
    if (!stageTarget) {
      setStageError("Choose a stage to move this case to.");
      return;
    }
    if (selectedOption?.kycBlocked) {
      setStageError(
        "This case can't be completed until KYC is verified. Record a verified KYC outcome first.",
      );
      return;
    }
    setStageConfirm(true);
  }, [stageTarget, selectedOption]);

  const applyStage = useCallback(
    async (reason?: string) => {
      if (!item || !stageTarget) return;
      // Guard the cancellation-reason minimum on the client too, so the dialog
      // doesn't submit a value the BE will 400 (REASON_REQUIRED).
      if (selectedOption?.requiresReason && !isValidCancellationReason(reason)) {
        setStageError(
          `A cancellation reason of at least ${CANCELLATION_REASON_MIN_LENGTH} characters is required.`,
        );
        return;
      }
      setStageBusy(true);
      setStageError("");
      try {
        const result = await advanceStage(item.id, {
          toStage: stageTarget,
          ...(selectedOption?.requiresReason && reason ? { reason } : {}),
          version: item.version,
        });
        setStageMessage(
          result.accepted
            ? "Stage change submitted — it may take a moment to take effect."
            : `Case moved to "${STAGE_LABELS[stageTarget]}".`,
        );
        setStageConfirm(false);
        setStageTarget("");
        reload();
      } catch (e) {
        // Surface the BE 422 (INVALID_TRANSITION / KYC_NOT_VERIFIED) verbatim.
        setStageError(e instanceof Error ? e.message : "Could not change the stage.");
      } finally {
        setStageBusy(false);
      }
    },
    [item, stageTarget, selectedOption, reload],
  );

  if (isLoading) {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
        Loading onboarding case…
      </p>
    );
  }

  if (!item) {
    return (
      <>
        {isError ? <DataSourceBadge source="error" /> : null}
        <EmptyState
          icon="📋"
          title={isError ? "Onboarding case couldn't be loaded" : "Onboarding case not found"}
          message={
            isError
              ? "Live data couldn't be reached. Try again in a moment."
              : "This case does not exist or has been removed."
          }
        />
      </>
    );
  }

  const sm = isOnboardingStage(item.stage) ? STAGE_META[item.stage] : null;
  const km = isKycStatus(item.kycStatus) ? KYC_META[item.kycStatus] : null;
  const terminal = stage ? isTerminalStage(stage) : false;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-h">
          <h3>Case {item.id}</h3>
          {isError ? <DataSourceBadge source="error" /> : null}
        </div>
        <div className="pad" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label="Stage">
            <span aria-hidden="true">{sm ? sm.icon : "•"}</span> {stageLabel(item.stage)}
          </Field>
          <Field label="KYC status">
            <span aria-hidden="true">{km ? km.icon : "•"}</span> {kycLabel(item.kycStatus)}
          </Field>
          <Field label="Account">{item.accountId ?? "—"}</Field>
          <Field label="Deal">{item.dealId || "—"}</Field>
          <Field label="KYC reference">{item.kycReference ?? "—"}</Field>
          <Field label="KYC verified">{fmtDate(item.kycVerifiedAt)}</Field>
          <Field label="Completed">{fmtDate(item.completedAt)}</Field>
          <Field label="Created">{fmtDate(item.createdAt)}</Field>
          <Field label="Updated">{fmtDate(item.updatedAt)}</Field>
          <Field label="Version">{String(item.version)}</Field>
          {item.cancellationReason ? (
            <Field label="Cancellation reason">{item.cancellationReason}</Field>
          ) : null}
        </div>
      </div>

      {/* KYC panel */}
      <div className="card">
        <div className="card-h">
          <h3 id={`${kycId}-h`}>Record KYC outcome</h3>
        </div>
        <div className="pad" style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            Current KYC status: <strong>{kycLabel(item.kycStatus)}</strong>. Marking KYC verified or rejected
            requires an approver role.
          </p>
          {kycNextOptions.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              KYC status “{kycLabel(item.kycStatus)}” is final — no further KYC changes are available.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor={`${kycId}-target`} style={labelStyle}>
                  New KYC outcome
                </label>
                <select
                  id={`${kycId}-target`}
                  value={kycTarget}
                  onChange={(e) => setKycTarget(e.target.value as KycStatus | "")}
                  aria-invalid={kycError && !kycTarget ? "true" : "false"}
                  style={inputStyle}
                >
                  <option value="">Select outcome…</option>
                  {kycNextOptions.map((s) => (
                    <option key={s} value={s}>
                      {KYC_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <button type="button" className="btn primary" onClick={beginKyc} style={{ minHeight: 44 }}>
                  Record KYC outcome
                </button>
              </div>
            </>
          )}
          {kycMessage ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>
              {kycMessage}
            </p>
          ) : null}
          {kycError ? (
            <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>
              {kycError}
            </p>
          ) : null}
        </div>
      </div>

      {/* Stage transition panel */}
      <div className="card">
        <div className="card-h">
          <h3 id={`${stageId}-h`}>Change stage</h3>
        </div>
        <div className="pad" style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            Current stage: <strong>{stageLabel(item.stage)}</strong>. Only the moves the onboarding workflow
            allows are shown.
          </p>
          {terminal || stageOptions.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              “{stageLabel(item.stage)}” is a final stage — no further changes are available.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor={`${stageId}-target`} style={labelStyle}>
                  Move to
                </label>
                <select
                  id={`${stageId}-target`}
                  value={stageTarget}
                  onChange={(e) => setStageTarget(e.target.value as OnboardingStage | "")}
                  aria-invalid={stageError && !stageTarget ? "true" : "false"}
                  style={inputStyle}
                >
                  <option value="">Select stage…</option>
                  {stageOptions.map((o) => (
                    <option key={o.stage} value={o.stage} disabled={o.kycBlocked}>
                      {STAGE_LABELS[o.stage]}
                      {o.kycBlocked ? " — needs verified KYC" : ""}
                    </option>
                  ))}
                </select>
                {selectedOption?.kycBlocked ? (
                  <p role="alert" style={{ fontSize: 12, color: "#b42318", marginTop: 4 }}>
                    Completion is gated: KYC must be verified first.
                  </p>
                ) : null}
                {selectedOption?.requiresReason ? (
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    Cancelling requires a reason of at least {CANCELLATION_REASON_MIN_LENGTH} characters.
                  </p>
                ) : null}
              </div>
              <div>
                <button type="button" className="btn primary" onClick={beginStage} style={{ minHeight: 44 }}>
                  Apply stage change
                </button>
              </div>
            </>
          )}
          {stageMessage ? (
            <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>
              {stageMessage}
            </p>
          ) : null}
          {stageError ? (
            <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", margin: 0 }}>
              {stageError}
            </p>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={kycConfirm}
        title={kycTarget ? `Record KYC as "${KYC_LABELS[kycTarget]}"?` : "Record KYC outcome?"}
        description="This KYC outcome is recorded against the onboarding case and drives the completion gate."
        confirmLabel="Record outcome"
        danger={kycTarget === "rejected"}
        busy={kycBusy}
        errorMessage={kycError || undefined}
        onCancel={() => setKycConfirm(false)}
        onConfirm={() => void applyKyc()}
      />

      <ConfirmDialog
        open={stageConfirm}
        title={stageTarget ? `Move case to "${STAGE_LABELS[stageTarget]}"?` : "Change stage?"}
        description={
          selectedOption?.requiresReason
            ? "Cancelling an onboarding is recorded with the reason below and cannot be undone."
            : stageTarget === "completed"
              ? "Completing onboarding hands the customer a live account. This cannot be undone."
              : "This stage change is recorded against the onboarding case."
        }
        confirmLabel={stageTarget === "cancelled" ? "Cancel onboarding" : "Confirm change"}
        danger={stageTarget === "cancelled" || stageTarget === "completed"}
        requireReason={selectedOption?.requiresReason ?? false}
        reasonLabel={`Cancellation reason (min ${CANCELLATION_REASON_MIN_LENGTH} characters)`}
        busy={stageBusy}
        errorMessage={stageError || undefined}
        onCancel={() => setStageConfirm(false)}
        onConfirm={(reason) => void applyStage(reason)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}
