"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button, Card, EntityPicker, type EntityOption } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";

type FormStatus = "idle" | "submitting" | "success";

const PURPOSE_MAX = 2000;
const PURPOSE_MIN = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApplyFormProps {
  schemeId: string;
  schemeName: string;
  minAmountMinor: number;
  maxAmountMinor: number;
  budgetMinor: number;
  windowHint: string | null;
  grantees: EntityOption[];
}

export function ApplyForm({
  schemeId,
  minAmountMinor,
  maxAmountMinor,
  windowHint,
  grantees,
}: ApplyFormProps) {
  const [beneficiaryId, setBeneficiaryId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [formStatus, setFormStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");
  const [applicationRef, setApplicationRef] = useState<string | null>(null);
  const formError = useFormError("grant application");

  // GAP-GRANTS-SCHEMES-DETAIL-APPLY-01: client-side search over the grantees
  // already loaded server-side — no second endpoint, selecting a row submits
  // its UUID.
  const searchGrantees = useMemo(() => {
    return (query: string): Promise<EntityOption[]> => {
      const q = query.trim().toLowerCase();
      const matches = q
        ? grantees.filter(
            (g) => g.label.toLowerCase().includes(q) || (g.sublabel ?? "").toLowerCase().includes(q),
          )
        : grantees;
      return Promise.resolve(matches.slice(0, 25));
    };
  }, [grantees]);

  const amountMinorStr = rupeesToMinorString(amountRupees);

  function showError(msg: string) {
    setFormStatus("idle");
    formError.clear();
    setMessage(msg);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // GAP-GRANTS-SCHEMES-DETAIL-APPLY-01: beneficiary must be a selected UUID.
    if (!beneficiaryId || !UUID_RE.test(beneficiaryId)) {
      return showError("Select a grantee from the list.");
    }
    if (purpose.trim().length < PURPOSE_MIN) {
      return showError(`Project purpose must be at least ${PURPOSE_MIN} characters.`);
    }
    // GAP-GRANTS-SCHEMES-DETAIL-APPLY-05: no float math.
    if (amountMinorStr === null) {
      return showError("Enter a valid amount in rupees (up to 2 decimals).");
    }
    // GAP-GRANTS-SCHEMES-DETAIL-APPLY-03: enforce the scheme's caps client-side
    // (advisory; the server also enforces them).
    const amountMinor = BigInt(amountMinorStr);
    if (minAmountMinor > 0 && amountMinor < BigInt(minAmountMinor)) {
      return showError(`Requested amount is below the scheme minimum of ${formatMoney(minAmountMinor)}.`);
    }
    if (maxAmountMinor > 0 && amountMinor > BigInt(maxAmountMinor)) {
      return showError(`Requested amount exceeds the scheme maximum of ${formatMoney(maxAmountMinor)}.`);
    }

    setFormStatus("submitting");
    setMessage("");
    formError.clear();

    try {
      const res = await fetch(`/api/proxy/v1/grants/schemes/${schemeId}/applications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          beneficiaryId,
          purpose: purpose.trim(),
          amountRequestedMinor: Number(amountMinor),
          currency: "INR",
        }),
      });
      if (!res.ok) {
        setFormStatus("idle");
        await formError.fromResponse(res, "save");
        return;
      }
      // GAP-GRANTS-SCHEMES-DETAIL-APPLY-02: read the new application id so we can
      // link straight to it; no blind 2s setTimeout redirect.
      let newId: string | null = null;
      try {
        const body = (await res.json()) as { id?: unknown };
        if (typeof body?.id === "string") newId = body.id;
      } catch {
        /* no body / non-JSON — fall back to the applications list */
      }
      setApplicationRef(newId);
      setFormStatus("success");
      setMessage("Application submitted. It is now under review.");
    } catch (caught) {
      setFormStatus("idle");
      formError.fromException("save", caught);
    }
  }

  const errorText = message && formStatus !== "success" ? message : formError.message || "";
  const panelField: React.CSSProperties = { background: "var(--panel)", padding: "13px 16px" };
  const hintStyle: React.CSSProperties = { fontSize: 12, color: "var(--ink2)", marginTop: 4, display: "block" };
  const errorStyle: React.CSSProperties = { fontSize: 12, color: "var(--bad)", marginTop: 4, display: "block" };

  if (formStatus === "success") {
    const href = applicationRef ? `/grants/applications/${applicationRef}` : "/grants/applications";
    return (
      <Card>
        <div role="status" className="card pad" style={{ maxWidth: 820 }}>
          <p style={{ color: "var(--good)", fontWeight: 600 }}>{message}</p>
          {applicationRef && (
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>Reference: {applicationRef}</p>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Link href={href} className="btn primary">
              View application
            </Link>
            <Link href={`/grants/schemes/${schemeId}`} className="btn">
              Back to scheme
            </Link>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="card pad"
      style={{ maxWidth: 820 }}
      noValidate
      aria-label="Grant application form"
    >
      <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 12px" }}>
        You are filing this application on behalf of the selected grantee; it is recorded as
        submitted by you.
      </p>

      <div className="fields">
        <div className="field" style={{ gridColumn: "1 / -1", ...panelField }}>
          <label className="label" htmlFor="beneficiary">
            Grantee <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
          </label>
          <EntityPicker
            id="beneficiary"
            aria-label="Grantee"
            value={beneficiaryId}
            onChange={(v) => setBeneficiaryId(Array.isArray(v) ? (v[0] ?? null) : v)}
            search={(q) => searchGrantees(q)}
            initialOptions={grantees}
            placeholder="Search by grantee name or code…"
          />
          <span style={hintStyle}>
            Pick the registered grantee. Their identifier is submitted automatically — no need to
            type a UUID.{" "}
            <Link href="/grants/grantees" style={{ color: "var(--ink)" }}>
              Browse grantees →
            </Link>
          </span>
          {formError.fieldError("beneficiaryId") && (
            <span style={errorStyle}>{formError.fieldError("beneficiaryId")}</span>
          )}
        </div>

        <div className="field" style={{ gridColumn: "1 / -1", ...panelField }}>
          <label className="label" htmlFor="purpose">
            Project Purpose / Description{" "}
            <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
          </label>
          <textarea
            id="purpose"
            className="inp"
            rows={5}
            value={purpose}
            maxLength={PURPOSE_MAX}
            onChange={(e) => setPurpose(e.target.value)}
            required
            aria-required="true"
            placeholder="Describe the project objectives, expected outcomes, and how funds will be utilised. Minimum 10 characters."
            aria-describedby="purpose-hint"
          />
          <span id="purpose-hint" style={hintStyle}>
            {purpose.length} / {PURPOSE_MAX} characters
          </span>
          {formError.fieldError("purpose") && (
            <span style={errorStyle}>{formError.fieldError("purpose")}</span>
          )}
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="amountRupees">
            Requested Amount (₹) <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>
          </label>
          <input
            id="amountRupees"
            className="inp"
            inputMode="decimal"
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            required
            aria-required="true"
            style={{ minHeight: 44 }}
            placeholder="e.g. 500000"
            aria-describedby="amount-hint"
          />
          <span id="amount-hint" style={hintStyle}>
            Enter in rupees (up to 2 decimals).{" "}
            {amountRupees.trim() !== "" &&
              (amountMinorStr !== null ? `= ${formatMoney(amountMinorStr)}` : "Enter a valid amount.")}
            {windowHint ? ` ${windowHint}` : ""}
          </span>
          {formError.fieldError("amountRequestedMinor") && (
            <span style={errorStyle}>{formError.fieldError("amountRequestedMinor")}</span>
          )}
        </div>

        <div className="field" style={panelField}>
          <label className="label" htmlFor="currency">
            Currency
          </label>
          {/* GAP-GRANTS-SCHEMES-DETAIL-APPLY-05: single-currency — read-only INR,
              not a one-option select. */}
          <input id="currency" className="inp" value="INR — Indian Rupee" readOnly style={{ minHeight: 44 }} />
        </div>
      </div>

      <div role="status" aria-live="polite" style={{ marginTop: 12 }}>
        {errorText ? (
          <p role="alert" style={{ color: "var(--bad)", fontSize: "0.875rem", margin: 0 }}>
            {errorText}
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
        <Button
          type="submit"
          variant="primary"
          style={{ minHeight: 44 }}
          disabled={formStatus === "submitting"}
          aria-busy={formStatus === "submitting"}
        >
          {formStatus === "submitting" ? "Submitting…" : "Submit Application"}
        </Button>
        <Link href={`/grants/schemes/${schemeId}`} className="btn" style={{ minHeight: 44 }}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
