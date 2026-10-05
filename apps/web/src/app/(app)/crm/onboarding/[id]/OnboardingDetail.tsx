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
 *     backend 422 (illegal transition / KYC gate / version conflict) is never
 *     swallowed — but since UX-020 it is also never shown raw: advanceStage
 *     rejects with a clerk-safe catalogued message (errorMessageFromResponse),
 *     not the backend's own code/text. After a mutation the case reloads.
 *
 * Read is gated on source==="error": a failed load renders the saved-info badge
 * and an explicit message, never a fabricated blank case as fact.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Button, ConfirmDialog, EmptyState, ErrorState, Masked } from "../../../../_components/ds";
import {
  advanceStage,
  recordKyc,
  getOnboardingCase,
  getOnboardingLookups,
  resolveCaseNames,
  allowedNextKycStatuses,
  nextStageOptions,
  isOnboardingStage,
  isKycStatus,
  STAGE_META,
  KYC_META,
  isTerminalStage,
  CANCELLATION_REASON_MIN_LENGTH,
  isValidCancellationReason,
  type OnboardingCase,
  type OnboardingLookups,
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

export function OnboardingDetail({ id, canApproveKyc = false }: { id: string; canApproveKyc?: boolean }) {
  const t = useTranslations("crmOnboardingDetail");
  const formError = useFormError("onboarding case");
  const stageText = useCallback((s: string): string => (isOnboardingStage(s) ? t(`stage_${s}`) : s), [t]);
  const kycText = useCallback((s: string): string => (isKycStatus(s) ? t(`kyc_${s}`) : s), [t]);
  const [item, setItem] = useState<OnboardingCase | null>(null);
  const [source, setSource] = useState<OnbSource | "loading">("loading");

  // KYC panel state.
  const [kycTarget, setKycTarget] = useState<KycStatus | "">("");
  const [kycReference, setKycReference] = useState("");
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
      // GAP-CRM-ONBOARDING-DETAIL-01: resolve the deal/account NAMES alongside
      // the case so the customer being onboarded is named, not shown as a raw
      // UUID. The onboarding module stores only opaque ids and never joins to
      // the deals/accounts modules (L2 isolation), so names are resolved in the
      // web layer from the list endpoints; a failed lookup just leaves names null.
      return Promise.all([getOnboardingCase(id), getOnboardingLookups()]).then(
        ([{ data, source: s }, lookups]: [{ data: OnboardingCase | null; source: OnbSource }, OnboardingLookups]) => {
          if (signal && !signal.alive) return;
          setItem(data ? resolveCaseNames([data], lookups)[0] ?? data : null);
          setSource(s);
        },
      );
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
  // GAP-CRM-ONBOARDING-DETAIL-03: a non-approver may only move KYC to
  // "submitted"; verified/rejected are approver-only (crm-service 403s them).
  // Hide those options rather than let the clerk pick an outcome that will be
  // refused only after the confirm dialog. The server stays the authority.
  const kycNextOptions = (kycStatus ? allowedNextKycStatuses(kycStatus) : []).filter(
    (s) => canApproveKyc || (s !== "verified" && s !== "rejected"),
  );

  const beginKyc = useCallback(() => {
    setKycError("");
    setKycMessage("");
    if (!kycTarget) {
      setKycError(t("chooseKycOutcome"));
      return;
    }
    // GAP-CRM-ONBOARDING-DETAIL-02: a KYC reference (the provider's opaque
    // check id) must be captured when the outcome is "verified" — the record
    // is incomplete without it. It is optional for "submitted"/"rejected".
    if (kycTarget === "verified" && kycReference.trim().length === 0) {
      setKycError(t("kycReferenceRequiredError"));
      return;
    }
    setKycConfirm(true);
  }, [kycTarget, kycReference, t]);

  const applyKyc = useCallback(async () => {
    if (!item || !kycTarget) return;
    setKycBusy(true);
    setKycError("");
    try {
      const trimmedRef = kycReference.trim();
      const result = await recordKyc(item.id, {
        status: kycTarget,
        ...(trimmedRef ? { reference: trimmedRef } : {}),
        version: item.version,
      });
      setKycMessage(
        result.accepted
          ? t("kycSubmitted")
          : t("kycRecordedAs", { status: kycText(kycTarget) }),
      );
      setKycConfirm(false);
      setKycTarget("");
      setKycReference("");
      reload();
    } catch (e) {
      setKycError(formError.fromException("save", e).message);
    } finally {
      setKycBusy(false);
    }
  }, [item, kycTarget, kycReference, reload, t, kycText, formError]);

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
      setStageError(t("chooseStage"));
      return;
    }
    if (selectedOption?.kycBlocked) {
      setStageError(t("completeNeedsKyc"));
      return;
    }
    setStageConfirm(true);
  }, [stageTarget, selectedOption, t]);

  const applyStage = useCallback(
    async (reason?: string) => {
      if (!item || !stageTarget) return;
      // Guard the cancellation-reason minimum on the client too, so the dialog
      // doesn't submit a value the BE will 400 (REASON_REQUIRED).
      if (selectedOption?.requiresReason && !isValidCancellationReason(reason)) {
        setStageError(t("cancellationReasonRequired", { min: CANCELLATION_REASON_MIN_LENGTH }));
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
            ? t("stageSubmitted")
            : t("stageMovedTo", { stage: stageText(stageTarget) }),
        );
        setStageConfirm(false);
        setStageTarget("");
        reload();
      } catch (e) {
        // Never silent — but since UX-020, e.message is already the
        // clerk-safe catalogued string errorMessageFromResponse built, not
        // the backend's raw 422 code/text (INVALID_TRANSITION /
        // KYC_NOT_VERIFIED).
        setStageError(formError.fromException("save", e).message);
      } finally {
        setStageBusy(false);
      }
    },
    [item, stageTarget, selectedOption, reload, t, stageText, formError],
  );

  if (isLoading) {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: 12 }}>
        {t("loading")}
      </p>
    );
  }

  if (!item) {
    // GAP-CRM-ONBOARDING-DETAIL-04: a failed load now offers a working Retry
    // (reload) instead of telling the clerk to "try again" with no control.
    // A genuine 404 is kept distinct — it is not retryable, so it gets a back
    // link to the register, not a retry button.
    if (isError) {
      return (
        <>
          <DataSourceBadge source="error" />
          <ErrorState
            error={{
              what: t("loadErrorWhat"),
              next: t("loadErrorNext"),
              actions: ["retry", "back"],
            }}
            onRetry={reload}
            backHref="/crm/onboarding"
          />
        </>
      );
    }
    return (
      <EmptyState
        icon="📋"
        title={t("notFoundTitle")}
        message={t("notFoundMessage")}
        action={
          <Link href="/crm/onboarding" className="btn ghost">
            {t("backToOnboarding")}
          </Link>
        }
      />
    );
  }

  const sm = isOnboardingStage(item.stage) ? STAGE_META[item.stage] : null;
  const km = isKycStatus(item.kycStatus) ? KYC_META[item.kycStatus] : null;
  const terminal = stage ? isTerminalStage(stage) : false;
  // GAP-CRM-ONBOARDING-DETAIL-01: name the customer being onboarded. Prefer the
  // deal name, fall back to the account name; the opaque id is kept only as a
  // small muted "Ref" for support lookups, never as the primary heading.
  const customerName = item.dealName ?? item.accountName ?? null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <div className="card-h">
          <h3>{t("heading", { name: customerName ?? t("unnamedCase") })}</h3>
          {isError ? <DataSourceBadge source="error" /> : null}
        </div>
        <div className="pad" style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <Field label={t("ref")}>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--muted)" }}>{item.id}</span>
          </Field>
          <Field label={t("stage")}>
            <span aria-hidden="true">{sm ? sm.icon : "•"}</span> {stageText(item.stage)}
          </Field>
          <Field label={t("kycStatus")}>
            <span aria-hidden="true">{km ? km.icon : "•"}</span> {kycText(item.kycStatus)}
          </Field>
          <Field label={t("account")}>
            {item.accountId ? (
              <Link href={`/crm/accounts/${item.accountId}`}>{item.accountName ?? t("viewAccount")}</Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label={t("deal")}>
            {item.dealId ? (
              <Link href={`/crm/deals/${item.dealId}`}>{item.dealName ?? t("viewDeal")}</Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label={t("kycReference")}>
            {/* GAP-CRM-ONBOARDING-DETAIL-05: the KYC reference is a DPDP-sensitive
                identifier, so it is masked (all but last 4) by default for every
                viewer. An audited reveal is a backend-dependent follow-up (there
                is no read-access-log endpoint for onboarding yet, and a reveal
                with no real audit behind it is worse than none). */}
            <Masked value={item.kycReference} kind="last4" fallback="—" ariaLabel={t("kycReference")} />
          </Field>
          <Field label={t("kycVerified")}>{fmtDate(item.kycVerifiedAt)}</Field>
          <Field label={t("completed")}>{fmtDate(item.completedAt)}</Field>
          <Field label={t("created")}>{fmtDate(item.createdAt)}</Field>
          <Field label={t("updated")}>{fmtDate(item.updatedAt)}</Field>
          <Field label={t("version")}>{String(item.version)}</Field>
          {item.cancellationReason ? (
            <Field label={t("cancellationReason")}>{item.cancellationReason}</Field>
          ) : null}
        </div>
      </div>

      {/* KYC panel */}
      <div className="card">
        <div className="card-h">
          <h3 id={`${kycId}-h`}>{t("recordKycOutcome")}</h3>
        </div>
        <div className="pad" style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            {t.rich("currentKyc", {
              status: kycText(item.kycStatus),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}{" "}
            {canApproveKyc ? t("kycApproverYes") : t("kycApproverNo")}
          </p>
          {kycNextOptions.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              {t("kycFinal", { status: kycText(item.kycStatus) })}
            </p>
          ) : (
            <>
              <div>
                <label htmlFor={`${kycId}-target`} style={labelStyle}>
                  {t("newKycOutcome")}
                </label>
                <select
                  id={`${kycId}-target`}
                  value={kycTarget}
                  onChange={(e) => setKycTarget(e.target.value as KycStatus | "")}
                  aria-invalid={kycError && !kycTarget ? "true" : "false"}
                  style={inputStyle}
                >
                  <option value="">{t("selectOutcome")}</option>
                  {kycNextOptions.map((s) => (
                    <option key={s} value={s}>
                      {kycText(s)}
                    </option>
                  ))}
                </select>
              </div>
              {/* GAP-CRM-ONBOARDING-DETAIL-02: capture the KYC reference (the
                  provider's opaque check id). Required for a verified outcome;
                  optional for submitted/rejected. */}
              {kycTarget === "submitted" || kycTarget === "verified" || kycTarget === "rejected" ? (
                <div>
                  <label htmlFor={`${kycId}-ref`} style={labelStyle}>
                    {kycTarget === "verified" ? t("kycReferenceRequired") : t("kycReferenceOptional")}
                  </label>
                  <input
                    id={`${kycId}-ref`}
                    type="text"
                    value={kycReference}
                    maxLength={120}
                    onChange={(e) => setKycReference(e.target.value)}
                    placeholder={t("kycReferencePlaceholder")}
                    aria-invalid={kycError && kycTarget === "verified" && !kycReference.trim() ? "true" : "false"}
                    style={inputStyle}
                  />
                </div>
              ) : null}
              <div>
                <Button onClick={beginKyc} style={{ minHeight: 44 }}>
                  {t("recordKycOutcome")}
                </Button>
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
          <h3 id={`${stageId}-h`}>{t("changeStage")}</h3>
        </div>
        <div className="pad" style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
            {t.rich("currentStage", {
              stage: stageText(item.stage),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          {terminal || stageOptions.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)" }}>
              {t("stageFinal", { stage: stageText(item.stage) })}
            </p>
          ) : (
            <>
              <div>
                <label htmlFor={`${stageId}-target`} style={labelStyle}>
                  {t("moveTo")}
                </label>
                <select
                  id={`${stageId}-target`}
                  value={stageTarget}
                  onChange={(e) => setStageTarget(e.target.value as OnboardingStage | "")}
                  aria-invalid={stageError && !stageTarget ? "true" : "false"}
                  style={inputStyle}
                >
                  <option value="">{t("selectStage")}</option>
                  {stageOptions.map((o) => (
                    <option key={o.stage} value={o.stage} disabled={o.kycBlocked}>
                      {o.kycBlocked ? t("stageNeedsKyc", { stage: stageText(o.stage) }) : stageText(o.stage)}
                    </option>
                  ))}
                </select>
                {selectedOption?.kycBlocked ? (
                  <p role="alert" style={{ fontSize: 12, color: "#b42318", marginTop: 4 }}>
                    {t("completionGated")}
                  </p>
                ) : null}
                {selectedOption?.requiresReason ? (
                  <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                    {t("cancelNeedsReason", { min: CANCELLATION_REASON_MIN_LENGTH })}
                  </p>
                ) : null}
              </div>
              <div>
                <Button onClick={beginStage} style={{ minHeight: 44 }}>
                  {t("applyStageChange")}
                </Button>
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
        title={kycTarget ? t("confirmKycTitle", { status: kycText(kycTarget) }) : t("confirmKycTitleDefault")}
        description={
          kycReference.trim()
            ? t("confirmKycDescriptionRef", { reference: kycReference.trim() })
            : t("confirmKycDescription")
        }
        confirmLabel={t("recordOutcome")}
        danger={kycTarget === "rejected"}
        busy={kycBusy}
        errorMessage={kycError || undefined}
        onCancel={() => setKycConfirm(false)}
        onConfirm={() => void applyKyc()}
      />

      <ConfirmDialog
        open={stageConfirm}
        title={stageTarget ? t("confirmStageTitle", { stage: stageText(stageTarget) }) : t("confirmStageTitleDefault")}
        description={
          selectedOption?.requiresReason
            ? t("confirmCancelDescription")
            : stageTarget === "completed"
              ? t("confirmCompleteDescription")
              : t("confirmStageDescription")
        }
        confirmLabel={stageTarget === "cancelled" ? t("cancelOnboarding") : t("confirmChange")}
        danger={stageTarget === "cancelled" || stageTarget === "completed"}
        requireReason={selectedOption?.requiresReason ?? false}
        reasonLabel={t("cancellationReasonLabel", { min: CANCELLATION_REASON_MIN_LENGTH })}
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
