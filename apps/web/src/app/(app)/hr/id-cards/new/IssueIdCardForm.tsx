"use client";

/**
 * GAP-HR-ID-CARDS-01: mirrors the backend's issueCardSchema (services/
 * hrms-service/src/modules/id-cards/routes.ts) -- only the fields an HR/
 * security admin actually needs to fill in by hand are exposed here
 * (employeeId/employeeCode/contractId/accessZones/accessHours/photo are
 * left for a later pass; the backend defaults accessHours and leaves the
 * rest optional, so omitting them here is a valid, narrower request, not an
 * invalid one).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { Field, Input, Select, Button } from "@/app/_components/ds";

const CARD_TYPES = [
  { value: "employee", label: "Employee" },
  { value: "contractual", label: "Contractual" },
  { value: "vendor_staff", label: "Vendor staff" },
  { value: "project_team", label: "Project team" },
  { value: "intern", label: "Intern" },
  { value: "visitor", label: "Visitor" },
] as const;

export function IssueIdCardForm() {
  const router = useRouter();
  const [holderName, setHolderName] = useState("");
  const [cardType, setCardType] = useState<string>("employee");
  const [designation, setDesignation] = useState("");
  const [department, setDepartment] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const err = useFormError("ID card");

  const showVendor = cardType === "vendor_staff" || cardType === "contractual";
  const showProject = cardType === "project_team";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSuccess("");
    err.clear();
    try {
      const res = await fetch("/api/proxy/v1/hrms/id-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          holderName,
          cardType,
          validUntil,
          ...(designation ? { designation } : {}),
          ...(department ? { department } : {}),
          ...(showVendor && vendorName ? { vendorName } : {}),
          ...(showProject && projectName ? { projectName } : {}),
        }),
      });
      if (!res.ok) {
        await err.fromResponse(res, "save");
        return;
      }
      setSuccess("ID card issued.");
      setHolderName("");
      setDesignation("");
      setDepartment("");
      setVendorName("");
      setProjectName("");
      setValidUntil("");
      router.push("/hr/id-cards");
      router.refresh();
    } catch {
      err.fromException("save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14, maxWidth: 480 }}>
      {err.message && (
        <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "var(--danger, #b91c1c)" }}>
          {err.message}
        </p>
      )}

      <Field id="ic-holder" label="Holder name" error={err.fieldError("holderName")} required>
        <Input required value={holderName} onChange={(e) => setHolderName(e.target.value)} minLength={2} maxLength={200} />
      </Field>

      <Field id="ic-type" label="Card type" error={err.fieldError("cardType")} required>
        <Select value={cardType} onChange={(e) => setCardType(e.target.value)}>
          {CARD_TYPES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </Select>
      </Field>

      <Field id="ic-designation" label="Designation (optional)" error={err.fieldError("designation")}>
        <Input value={designation} onChange={(e) => setDesignation(e.target.value)} maxLength={100} />
      </Field>

      <Field id="ic-department" label="Department (optional)" error={err.fieldError("department")}>
        <Input value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={100} />
      </Field>

      {showVendor && (
        <Field id="ic-vendor" label="Vendor name" error={err.fieldError("vendorName")}>
          <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} maxLength={200} />
        </Field>
      )}

      {showProject && (
        <Field id="ic-project" label="Project name" error={err.fieldError("projectName")}>
          <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} maxLength={200} />
        </Field>
      )}

      <Field id="ic-valid-until" label="Valid until" error={err.fieldError("validUntil")} required>
        <Input type="date" required value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
      </Field>

      {success && (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--ok, #15803d)" }}>
          {success}
        </p>
      )}

      <Button type="submit" disabled={busy} style={{ minHeight: 44 }}>
        {busy ? "Issuing…" : "Issue card"}
      </Button>
    </form>
  );
}
