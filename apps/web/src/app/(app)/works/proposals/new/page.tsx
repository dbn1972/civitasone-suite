"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/app/_components/ds/Toast";
import { PageHeader } from "@/app/_components/ds";

const inputStyle = { width: "100%", padding: 8, minHeight: 44, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;
const errBanner = { background: "#fef2f2", color: "#b42318", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;
const okBanner = { background: "#ecfdf3", padding: 12, borderRadius: 12, marginBottom: 16, fontSize: 13 } as const;

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
  const { toast } = useToast();
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
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function set(field: StringFormField) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value } as ProposalForm));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const body: Record<string, string> = {
        description: form.description,
        category: form.category,
        estimatedCostMinor: String(Math.round(Number(form.estimatedCost || "0") * 100)),
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
      const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? "Create failed");
      setMessage("Created.");
      toast.success("Work proposal submitted.");
      setTimeout(() => router.push("/works/proposals"), 600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New Work Proposal"
        subtitle="Submit a new work proposal for approval."
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

          <div>
            <label style={labelStyle}>Description *</label>
            <textarea
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
              <label style={labelStyle}>Category *</label>
              <select
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
              <label style={labelStyle}>Estimated cost (₹) *</label>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                value={form.estimatedCost}
                onChange={set("estimatedCost")}
                style={inputStyle}
                placeholder="e.g. 500000"
              />
            </div>

            <div>
              <label style={labelStyle}>Work type ID (UUID)</label>
              <input
                type="text"
                value={form.workTypeId}
                onChange={set("workTypeId")}
                style={inputStyle}
                placeholder="UUID from masters"
              />
            </div>

            <div>
              <label style={labelStyle}>District</label>
              <input
                type="text"
                maxLength={128}
                value={form.district}
                onChange={set("district")}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Taluka</label>
              <input
                type="text"
                maxLength={128}
                value={form.taluka}
                onChange={set("taluka")}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Village / locality</label>
              <input
                type="text"
                maxLength={128}
                value={form.village}
                onChange={set("village")}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Remarks</label>
            <textarea
              maxLength={2048}
              value={form.remarks}
              onChange={set("remarks")}
              style={{ ...inputStyle, minHeight: 72 }}
              placeholder="Optional notes..."
            />
          </div>

          <button
            type="submit"
            className="btn primary"
            disabled={busy}
            style={{ minHeight: 44 }}
          >
            {busy ? "Submitting..." : "Submit"}
          </button>
        </form>
      </div>
    </>
  );
}
