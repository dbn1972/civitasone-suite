"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, Field, Input, Select, Textarea, EntityPicker } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { recentFinancialYears } from "@/lib/fiscalYear";
import {
  searchWorkProposals,
  resolveWorkProposals,
  isTsEligibleStatus,
  TS_ELIGIBLE_STATUSES,
  type WorkProposalOption,
} from "@/lib/entityAdapters/workProposal";
import { DirectoryPicker } from "@/app/_components/DirectoryPicker";

// Token-based banner styles (no hard-coded hex).
const okBanner: React.CSSProperties = { background: "var(--good-bg)", color: "var(--good)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 };
const errBanner: React.CSSProperties = { background: "var(--bad-bg)", color: "var(--bad)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 };
const infoBanner: React.CSSProperties = { background: "var(--info-bg)", color: "var(--info)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 };
const warnBanner: React.CSSProperties = { background: "var(--warn-bg)", color: "var(--warn)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 };

// Upper bound: ₹999,99,99,999.99 (just under 1,000 crore) in paise.
const MAX_AMOUNT_MINOR = 99999999999n;

export function NewTsForm({ initialWorkId = "" }: { initialWorkId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("works.tsNew");
  const srYears = recentFinancialYears(6);
  const [form, setForm] = useState({
    workId: initialWorkId,
    tsNumber: "",
    tsDate: "",
    tsAuthorityId: "",
    srYear: "",
    zone: "",
    tsAmount: "",
    remarks: "",
  });
  const [amountError, setAmountError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("technical sanction");

  // Status of every work the picker has shown or resolved, by id, so the banner and the Create button follow the work
  // the user actually selected (including one prefilled from ?workId=, which skips the search).
  const [workStatuses, setWorkStatuses] = useState<Record<string, string | null>>({});
  const remember = useCallback((opts: WorkProposalOption[]) => {
    setWorkStatuses((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const o of opts) {
        if (!(o.id in prev) || prev[o.id] !== o.status) {
          next[o.id] = o.status;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    return opts;
  }, []);
  // A work that is not eligible is LISTED, disabled with the reason, rather than filtered out of the picker.
  const searchWork = useCallback(
    async (q: string, signal: AbortSignal) =>
      remember(
        await searchWorkProposals(q, signal, {
          strict: true,
          eligibleStatuses: TS_ELIGIBLE_STATUSES,
          ineligibleReason: () => t("notDaoFinalized"),
        }),
      ),
    [remember, t],
  );
  const resolveWork = useCallback(async (ids: string[]) => remember(await resolveWorkProposals(ids)), [remember]);

  const workKnown = form.workId !== "" && form.workId in workStatuses;
  const workEligible = workKnown && isTsEligibleStatus(workStatuses[form.workId]);
  const workBlocked = workKnown && !workEligible;
  const missingSelection = !form.workId || !form.tsAuthorityId;

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function validateAmount(): string | null {
    const minor = rupeesToMinorString(form.tsAmount.trim());
    if (minor === null) {
      return "Enter a valid amount in rupees (greater than zero, up to two decimals).";
    }
    if (BigInt(minor) > MAX_AMOUNT_MINOR) {
      return "Amount is too large. Check the figure and try again.";
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (missingSelection) {
      setError(t("selectToContinue"));
      return;
    }
    if (workBlocked) {
      setError(t("bannerBlocked"));
      return;
    }
    const amtErr = validateAmount();
    setAmountError(amtErr ?? "");
    if (amtErr) return;
    const tsAmountMinor = rupeesToMinorString(form.tsAmount.trim());
    if (tsAmountMinor === null) {
      setAmountError("Enter a valid amount in rupees (greater than zero, up to two decimals).");
      return;
    }
    setBusy(true);
    formError.clear();
    try {
      const body: Record<string, string> = {
        workId: form.workId.trim(),
        tsNumber: form.tsNumber.trim(),
        tsDate: form.tsDate,
        tsAuthorityId: form.tsAuthorityId.trim(),
        tsAmountMinor,
      };
      if (form.srYear.trim()) body.srYear = form.srYear.trim();
      if (form.zone.trim()) body.zone = form.zone.trim();
      if (form.remarks.trim()) body.remarks = form.remarks.trim();

      const res = await fetch("/api/proxy/v1/works/approvals/ts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      // The service accepts the create asynchronously (HTTP 202) — the record
      // is queued, not yet written — so we say "submitted", not "created", to
      // match the AA form and the finalize button (GAP-WORKS-APPROVALS-TS-NEW-02).
      setMessage("Technical sanction submitted. It will appear in the register once processed.");
      toast.success("Technical sanction submitted.");
      setTimeout(() => router.push("/works/approvals"), 700);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Technical Sanction"
        subtitle="Create a Technical Sanction (TS) record for a work."
        back="/works/approvals"
        backLabel="Approvals"
      />
      {/* The banner follows the selected work: neutral until one is chosen, then eligible / blocked. */}
      {workBlocked ? (
        <div role="alert" style={warnBanner}>
          {t("bannerBlocked")}
        </div>
      ) : workEligible ? (
        <div role="status" style={infoBanner}>
          {t("bannerEligible")}
        </div>
      ) : (
        <div role="note" style={infoBanner}>
          {t("daoBanner")}
        </div>
      )}
      {message ? (
        <div role="status" aria-live="polite" style={okBanner}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div role="alert" aria-live="assertive" style={errBanner}>
          {error}
        </div>
      ) : null}
      <div className="card">
        <form
          onSubmit={submit}
          noValidate
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <Field label="Work" required id="ts-new-work-id">
              <EntityPicker
                id="ts-new-work-id"
                value={form.workId || null}
                onChange={(v) => setForm((prev) => ({ ...prev, workId: Array.isArray(v) ? (v[0] ?? "") : (v ?? "") }))}
                // BR-011: a TS needs a DAO-finalized work. Others are listed but disabled, with the reason; the
                // server's canEnterTS allow-list is still the authority.
                search={searchWork}
                resolve={resolveWork}
                placeholder={t("workPlaceholder")}
                searchErrorText={t("workSearchFailed")}
                aria-label="Work"
              />
            </Field>

            <Field label="TS Number" required id="ts-new-ts-number">
              <Input
                id="ts-new-ts-number"
                type="text"
                value={form.tsNumber}
                onChange={set("tsNumber")}
                placeholder="e.g. TS/2026-27/001"
                maxLength={64}
              />
            </Field>

            <Field label="Sanction date" required id="ts-new-sanction-date">
              <Input id="ts-new-sanction-date" type="date" value={form.tsDate} onChange={set("tsDate")} />
            </Field>

            <Field label="TS authority" required id="ts-new-authority-id">
              {/* The tenant user directory (names only, open to any member): the admin-gated /identity/users list
                  this used to call is not reachable for a works clerk. */}
              <DirectoryPicker
                source="user"
                id="ts-new-authority-id"
                value={form.tsAuthorityId || null}
                onChange={(id) => setForm((prev) => ({ ...prev, tsAuthorityId: id ?? "" }))}
                aria-label="TS authority"
              />
            </Field>

            <Field label="SR Year (optional)" id="ts-new-sr-year">
              <Select id="ts-new-sr-year" value={form.srYear} onChange={set("srYear")}>
                <option value="">Select SR year…</option>
                {srYears.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Zone (optional)" id="ts-new-zone">
              <Input
                id="ts-new-zone"
                type="text"
                value={form.zone}
                onChange={set("zone")}
                placeholder="e.g. Central Zone, Bhubaneswar"
                maxLength={64}
              />
            </Field>

            <Field label="Sanction amount (₹)" required id="ts-new-amount" error={amountError || undefined}>
              <Input
                id="ts-new-amount"
                type="text"
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                value={form.tsAmount}
                onChange={(e) => {
                  setAmountError("");
                  set("tsAmount")(e);
                }}
                placeholder="0.00"
              />
            </Field>
          </div>

          <Field label="Remarks" id="ts-new-remarks">
            <Textarea
              id="ts-new-remarks"
              style={{ minHeight: 80 }}
              value={form.remarks}
              onChange={set("remarks")}
              maxLength={2048}
              placeholder="Optional notes or remarks"
            />
          </Field>

          {missingSelection ? (
            <p id="ts-new-submit-hint" style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
              {t("selectToContinue")}
            </p>
          ) : null}

          <div style={{ display: "flex", gap: 12 }}>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || missingSelection || workBlocked}
              aria-describedby={missingSelection ? "ts-new-submit-hint" : undefined}
              style={{ minHeight: 44 }}
            >
              {busy ? "Submitting..." : "Create"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => router.push("/works/approvals")}
              disabled={busy}
              style={{ minHeight: 44 }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
