"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";

const RTI_SECTIONS = [
  { value: "s.6",  label: "§6 — Information Request" },
  { value: "s.11", label: "§11 — Third-party Information" },
] as const;

const SAMPLE_DEPARTMENTS = [
  "Ministry of Finance",
  "Department of Revenue",
  "Ministry of Home Affairs",
  "Ministry of Health & Family Welfare",
  "Ministry of Education",
  "Department of Posts",
  "UIDAI",
  "Other",
];

export default function NewRtiPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);

    const feeAmountRaw = fd.get("feeAmount");
    const body = {
      section:          fd.get("section"),
      departmentRef:    fd.get("departmentRef"),
      applicantName:    fd.get("applicantName"),
      applicantContact: fd.get("applicantContact") || undefined,
      subject:          fd.get("subject"),
      description:      fd.get("description"),
      feePaid:          fd.get("feePaid") === "true",
      feeAmount:        feeAmountRaw ? Number(feeAmountRaw) : undefined,
    };

    try {
      const res = await fetch("/api/proxy/v1/crm/rti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          (json as { message?: string }).message ?? `HTTP ${res.status}`,
        );
      }
      const { data } = (await res.json()) as { data: { id: string } };
      router.push(`/crm/rti/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
      setSaving(false);
    }
  }

  const fieldStyle = {
    padding: "8px 12px",
    border: "1px solid var(--line)",
    borderRadius: "var(--r)",
    background: "var(--bg)",
    color: "var(--ink)",
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 4,
    fontSize: 14,
    color: "var(--ink)",
  };

  const req = (
    <span aria-hidden="true" style={{ color: "var(--bad)" }}>
      {" "}*
    </span>
  );

  return (
    <>
      <PageHeader
        title="New RTI Request"
        subtitle="Log a Right to Information Act 2005 request."
        back="/crm/rti"
        backLabel="RTI Requests"
      />

      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r)",
          padding: "24px 28px",
          maxWidth: 680,
        }}
      >
        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              background: "color-mix(in srgb, var(--bad) 10%, transparent)",
              border: "1px solid var(--bad)",
              borderRadius: "var(--r)",
              color: "var(--bad)",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 18 }}
        >
          {/* ── RTI Metadata ── */}
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>
              RTI Details
            </legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
              >
                <label style={labelStyle}>
                  <span>Section{req}</span>
                  <select name="section" required style={fieldStyle}>
                    <option value="">Select section…</option>
                    {RTI_SECTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={labelStyle}>
                  <span>Department / Public Authority{req}</span>
                  <input
                    list="dept-suggestions"
                    name="departmentRef"
                    required
                    maxLength={200}
                    placeholder="e.g. Ministry of Finance"
                    style={fieldStyle}
                  />
                  <datalist id="dept-suggestions">
                    {SAMPLE_DEPARTMENTS.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label style={labelStyle}>
                <span>Subject{req}</span>
                <input
                  name="subject"
                  required
                  maxLength={500}
                  placeholder="Brief one-line subject of the RTI request"
                  style={fieldStyle}
                />
              </label>

              <label style={labelStyle}>
                <span>Description / Particulars Sought{req}</span>
                <textarea
                  name="description"
                  required
                  rows={5}
                  maxLength={10000}
                  placeholder="Describe the information sought under the RTI Act…"
                  style={{ ...fieldStyle, resize: "vertical" }}
                />
              </label>
            </div>
          </fieldset>

          {/* ── Applicant Details ── */}
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>
              Applicant Details
            </legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={labelStyle}>
                <span>Full Name{req}</span>
                <input
                  name="applicantName"
                  required
                  maxLength={200}
                  placeholder="Applicant's full name"
                  style={fieldStyle}
                />
              </label>

              <label style={labelStyle}>
                <span>Contact (Phone / Email)</span>
                <input
                  name="applicantContact"
                  maxLength={200}
                  placeholder="Phone number or email"
                  style={fieldStyle}
                />
              </label>
            </div>
          </fieldset>

          {/* ── Fee ── */}
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, marginBottom: 12, color: "var(--ink)" }}>
              Application Fee
            </legend>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={labelStyle}>
                <span>Fee Paid?</span>
                <select name="feePaid" defaultValue="false" style={fieldStyle}>
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              </label>

              <label style={labelStyle}>
                <span>Fee Amount (INR)</span>
                <input
                  name="feeAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 10.00"
                  style={fieldStyle}
                />
              </label>
            </div>
          </fieldset>

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "flex-end",
              marginTop: 4,
            }}
          >
            <a href="/crm/rti" className="btn">
              Cancel
            </a>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? "Filing…" : "File RTI Request"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
