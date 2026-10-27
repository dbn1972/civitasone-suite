"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader, Button, EntityPicker, Field, ConfirmDialog } from "@/app/_components/ds";
import { formatMoney, rupeeStringToPaise } from "@/lib/formatters";
import { searchWorkTypes, resolveWorkTypes } from "@/lib/entityAdapters/workType";
import { useFormError } from "@/lib/useFormError";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "var(--badbg)", color: "var(--bad)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "var(--goodbg)", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

type Category = "regular" | "deposit" | "salary";

type ProposalForm = {
  description: string;
  category: Category;
  estimatedCost: string;
  workTypeId: string;
  district: string;
  taluka: string;
  village: string;
  remarks: string;
};

type StringFormField = Exclude<keyof ProposalForm, "category">;

export default function NewProposalPage() {
  const router = useRouter();
  const t = useTranslations("works.location");
  const { toast } = useToast();
  // SF-19: unsaved-changes prompt is the shared ConfirmDialog, not window.confirm.
  const [discardOpen, setDiscardOpen] = useState(false);
  const [form, setForm] = useState<ProposalForm>({
    description: "",
    category: "regular",
    estimatedCost: "",
    workTypeId: "",
    district: "",
    taluka: "",
    village: "",
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  // CLOS3-S3-16: latched after a successful POST so the pending redirect cannot be raced by a second submit.
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const formError = useFormError("proposal");

  // GAP-WORKS-PROPOSALS-NEW-05: warn before losing unsaved input on reload /
  // tab close. "dirty" = any field differs from the pristine initial form.
  const dirty =
    !message &&
    (form.description !== "" ||
      form.estimatedCost !== "" ||
      form.workTypeId !== "" ||
      form.district !== "" ||
      form.taluka !== "" ||
      form.village !== "" ||
      form.remarks !== "" ||
      form.category !== "regular");

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // D4c #44: warn (never block) when a proposal with the same title, category and location already exists this
  // financial year. Debounced; a failed check shows nothing (the server does not depend on it).
  const tDup = useTranslations("works.proposalDuplicate");
  const [duplicates, setDuplicates] = useState<Array<{ id: string; workNumber: string }>>([]);
  const [duplicateFy, setDuplicateFy] = useState("");
  useEffect(() => {
    if (!form.description.trim() || saved) {
      setDuplicates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ description: form.description.trim(), category: form.category });
          if (form.district.trim()) qs.set("district", form.district.trim());
          if (form.taluka.trim()) qs.set("taluka", form.taluka.trim());
          if (form.village.trim()) qs.set("village", form.village.trim());
          const res = await fetch(`/api/proxy/v1/works/proposals/duplicate-check?${qs.toString()}`);
          if (!res.ok || cancelled) return;
          const body = (await res.json()) as { data?: { duplicates?: Array<{ id?: unknown; workNumber?: unknown }>; financialYear?: unknown } };
          if (cancelled) return;
          const rows = (body.data?.duplicates ?? [])
            .filter((d) => typeof d.id === "string" && typeof d.workNumber === "string")
            .map((d) => ({ id: d.id as string, workNumber: d.workNumber as string }));
          setDuplicates(rows);
          setDuplicateFy(typeof body.data?.financialYear === "string" ? body.data.financialYear : "");
        } catch {
          if (!cancelled) setDuplicates([]);
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.description, form.category, form.district, form.taluka, form.village, saved]);

  function set(field: StringFormField) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value } as ProposalForm));
  }

  // GAP-WORKS-PROPOSALS-NEW-02: money is bigint paise. Parse the typed rupee
  // string exactly in BigInt (no float), echo the formatted amount live, and
  // reject a zero / blank / over-precise cost before it ever reaches the API.
  const estimatedCostMinor = rupeeStringToPaise(form.estimatedCost);
  const costEcho =
    form.estimatedCost.trim() === ""
      ? null
      : estimatedCostMinor === null
        ? "Enter a valid amount in rupees (up to two decimals)."
        : estimatedCostMinor === "0"
          ? "Estimated cost must be more than ₹0."
          : formatMoney(estimatedCostMinor);
  const costValid = estimatedCostMinor !== null && estimatedCostMinor !== "0";

  function handleCancel() {
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    router.push("/works/proposals");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saved || busy) return;
    setMessage("");
    setError("");
    formError.clear();

    if (!costValid) {
      setError("Enter a valid estimated cost in rupees (more than ₹0, up to two decimals).");
      return;
    }

    setBusy(true);
    let ok = false;
    try {
      const body: Record<string, string> = {
        description: form.description,
        category: form.category,
        estimatedCostMinor,
      };
      if (form.workTypeId) body.workTypeId = form.workTypeId;
      if (form.district) body.district = form.district;
      if (form.taluka) body.taluka = form.taluka;
      if (form.village) body.village = form.village;
      if (form.remarks) body.remarks = form.remarks;
      const res = await fetch("/api/proxy/v1/works/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      // GAP-WORKS-PROPOSALS-NEW-03: creation yields a DRAFT (the backend sets
      // status "draft"; DAO finalization is a separate action on the detail
      // page). Say so honestly rather than "submitted / for approval".
      const created = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const newId = typeof created.id === "string" ? created.id : undefined;
      ok = true;
      setSaved(true);
      setMessage("Draft proposal created.");
      toast.success("Draft proposal created.");
      setTimeout(() => router.push(newId ? `/works/proposals/${newId}` : "/works/proposals"), 600);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      if (!ok) setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Work Proposal"
        subtitle="Create a draft work proposal. You can finalize it for DAO from its detail page."
        back="/works/proposals"
        backLabel="Proposals"
      />
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
          className="pad"
          style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 640 }}
        >
          <p style={{ fontSize: 12, color: "var(--muted)" }}>Fields marked * are required.</p>

          {duplicates.length > 0 && (
            <div role="note" data-testid="duplicate-proposals-warning" style={{ fontSize: 12, color: "var(--warn)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px" }}>
              <p style={{ margin: 0 }}>{tDup("warning", { fy: duplicateFy || "—" })}</p>
              <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
                {duplicates.map((d) => (
                  <li key={d.id}><Link href={`/works/proposals/${d.id}`}>{d.workNumber}</Link></li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label htmlFor="proposal-new-description" style={labelStyle}>Description *</label>
            <textarea
              id="proposal-new-description"
              required
              maxLength={2048}
              value={form.description}
              onChange={set("description")}
              style={{ ...inputStyle, minHeight: 88 }}
              placeholder="Describe the work..."
            />
          </div>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div>
              <label htmlFor="proposal-new-category" style={labelStyle}>Category *</label>
              <select
                id="proposal-new-category"
                required
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value as Category }))
                }
                style={inputStyle}
              >
                <option value="regular">Regular</option>
                <option value="deposit">Deposit</option>
                <option value="salary">Salary</option>
              </select>
            </div>

            <div>
              <label htmlFor="proposal-new-estimated-cost" style={labelStyle}>Estimated cost (₹) *</label>
              <input
                id="proposal-new-estimated-cost"
                type="number"
                required
                min={0.01}
                step="0.01"
                value={form.estimatedCost}
                onChange={set("estimatedCost")}
                style={inputStyle}
                placeholder="e.g. 500000"
                aria-describedby="proposal-new-cost-echo"
                aria-invalid={costEcho !== null && !costValid ? true : undefined}
              />
              {costEcho ? (
                <p
                  id="proposal-new-cost-echo"
                  role={costValid ? undefined : "alert"}
                  style={{ margin: "4px 0 0", fontSize: 12, color: costValid ? "var(--muted)" : "var(--bad)" }}
                >
                  {costValid ? `= ${costEcho}` : costEcho}
                </p>
              ) : null}
            </div>

            <div>
              <Field label="Work type">
                <EntityPicker
                  aria-label="Work type"
                  value={form.workTypeId || null}
                  onChange={(val) =>
                    setForm((f) => ({ ...f, workTypeId: Array.isArray(val) ? (val[0] ?? "") : (val ?? "") }))
                  }
                  search={searchWorkTypes}
                  resolve={resolveWorkTypes}
                  placeholder="Search work types by name…"
                />
              </Field>
            </div>

            <div>
              <label htmlFor="proposal-new-district" style={labelStyle}>District</label>
              <input
                id="proposal-new-district"
                type="text"
                maxLength={128}
                value={form.district}
                onChange={set("district")}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="proposal-new-taluka" style={labelStyle}>{t("tehsilBlock")}</label>
              <input
                id="proposal-new-taluka"
                type="text"
                maxLength={128}
                value={form.taluka}
                onChange={set("taluka")}
                style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="proposal-new-village" style={labelStyle}>Village / locality</label>
              <input
                id="proposal-new-village"
                type="text"
                maxLength={128}
                value={form.village}
                onChange={set("village")}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label htmlFor="proposal-new-remarks" style={labelStyle}>Remarks</label>
            <textarea
              id="proposal-new-remarks"
              maxLength={2048}
              value={form.remarks}
              onChange={set("remarks")}
              style={{ ...inputStyle, minHeight: 72 }}
              placeholder="Optional notes..."
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || saved}
              style={{ minHeight: 44 }}
            >
              {busy || saved ? "Creating…" : "Create draft"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || saved}
              onClick={handleCancel}
              style={{ minHeight: 44 }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={discardOpen}
        danger
        title="Discard this draft proposal?"
        description="Your entries will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setDiscardOpen(false);
          router.push("/works/proposals");
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}
