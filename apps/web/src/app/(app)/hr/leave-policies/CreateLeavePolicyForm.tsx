"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../_components/ds";

type LeaveType = { id: string; code: string; name: string };

const EMPLOYEE_TYPES = [
  { value: "permanent", label: "Permanent" },
  { value: "contractual", label: "Contractual" },
  { value: "vendor_deputed", label: "Vendor Deputed" },
  { value: "deputation", label: "Deputation" },
  { value: "consultant", label: "Consultant" },
  { value: "temporary", label: "Temporary" },
  { value: "intern", label: "Intern" },
  { value: "apprentice", label: "Apprentice" },
  { value: "volunteer", label: "Volunteer" },
];

const COUNT_METHODS = [
  { value: "calendar", label: "Calendar days" },
  { value: "working_days", label: "Working days only" },
];

export function CreateLeavePolicyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [ltLoading, setLtLoading] = useState(false);

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [employeeType, setEmployeeType] = useState("permanent");
  const [maxDaysPerYear, setMaxDaysPerYear] = useState("30");
  const [carryForward, setCarryForward] = useState(false);
  const [maxAccumulation, setMaxAccumulation] = useState("0");
  const [encashable, setEncashable] = useState(false);
  const [countMethod, setCountMethod] = useState("calendar");
  const [maxContinuousDays, setMaxContinuousDays] = useState("365");
  const [minServiceMonths, setMinServiceMonths] = useState("0");
  const [genderRestriction, setGenderRestriction] = useState<"" | "male" | "female">("");
  const [requiresMedicalCert, setRequiresMedicalCert] = useState(false);
  const [requiresMedicalCertAfterDays, setRequiresMedicalCertAfterDays] = useState("3");
  const [prefixSuffixRule, setPrefixSuffixRule] = useState(false);
  const [sandwichRule, setSandwichRule] = useState(false);
  const [proRataOnJoining, setProRataOnJoining] = useState(true);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [fieldError, setFieldError] = useState<string | null>(null);

  const ltField = useId();
  const empField = useId();
  const daysField = useId();
  const errId = useId();
  const ltRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!open || leaveTypes.length > 0) return;
    setLtLoading(true);
    fetch("/api/proxy/v1/hrms/leave-types")
      .then((r) => r.json())
      .then((body: unknown) => {
        const arr = Array.isArray(body) ? body : (body as { data?: LeaveType[] })?.data ?? [];
        setLeaveTypes(arr as LeaveType[]);
        if ((arr as LeaveType[])[0]) setLeaveTypeId((arr as LeaveType[])[0].id);
      })
      .catch(() => setFieldError("Could not load leave types."))
      .finally(() => setLtLoading(false));
  }, [open, leaveTypes.length]);

  function validate() {
    if (!leaveTypeId) return "Please select a leave type.";
    if (!employeeType) return "Please select an employee type.";
    const days = Number(maxDaysPerYear);
    if (!Number.isInteger(days) || days < 0 || days > 730) return "Days per year must be 0–730.";
    return null;
  }

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const msg = validate();
    if (msg) { setFieldError(msg); return; }
    setFieldError(null);
    setConfirmOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/proxy/v1/hrms/admin/leave-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveTypeId,
          employeeType,
          maxDaysPerYear: Number(maxDaysPerYear),
          carryForward,
          maxAccumulation: Number(maxAccumulation),
          encashable,
          countMethod,
          maxContinuousDays: Number(maxContinuousDays),
          minServiceMonths: Number(minServiceMonths),
          genderRestriction: genderRestriction || null,
          requiresMedicalCert,
          requiresMedicalCertAfterDays: Number(requiresMedicalCertAfterDays),
          prefixSuffixRule,
          sandwichRule,
          proRataOnJoining,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setError(txt || `Failed to create policy (${res.status})`);
        return;
      }
      setConfirmOpen(false);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const selectedLt = leaveTypes.find((l) => l.id === leaveTypeId);

  return (
    <div style={{ marginBottom: 16 }}>
      {!open ? (
        <button type="button" className="btn primary" onClick={() => setOpen(true)}>
          + New Policy
        </button>
      ) : (
        <form onSubmit={openConfirm} noValidate>
          <Card title="New Leave Policy" padding>
            {fieldError && (
              <p id={errId} role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 13, marginBottom: 12 }}>
                {fieldError}
              </p>
            )}

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={ltField} style={{ fontSize: 13, fontWeight: 600 }}>
                  Leave Type <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                {ltLoading ? (
                  <p style={{ fontSize: 13, color: "var(--mut)" }}>Loading leave types…</p>
                ) : (
                  <select
                    id={ltField}
                    ref={ltRef}
                    value={leaveTypeId}
                    onChange={(e) => setLeaveTypeId(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  >
                    {leaveTypes.length === 0 && <option value="">No leave types available</option>}
                    {leaveTypes.map((lt) => (
                      <option key={lt.id} value={lt.id}>{lt.code} — {lt.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={empField} style={{ fontSize: 13, fontWeight: 600 }}>
                  Employee Type <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                <select
                  id={empField}
                  value={employeeType}
                  onChange={(e) => setEmployeeType(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                >
                  {EMPLOYEE_TYPES.map((et) => (
                    <option key={et.value} value={et.value}>{et.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={daysField} style={{ fontSize: 13, fontWeight: 600 }}>
                  Days per year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                <input
                  id={daysField}
                  type="number"
                  min={0}
                  max={730}
                  value={maxDaysPerYear}
                  onChange={(e) => setMaxDaysPerYear(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Count Method</span>
                <select
                  value={countMethod}
                  onChange={(e) => setCountMethod(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                >
                  {COUNT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <details style={{ marginTop: 16 }}>
              <summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--primary-d)", userSelect: "none" }}>
                Advanced settings
              </summary>
              <div style={{ marginTop: 12, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Max accumulation (days)</span>
                  <input
                    type="number" min={0}
                    value={maxAccumulation}
                    onChange={(e) => setMaxAccumulation(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Max continuous (days)</span>
                  <input
                    type="number" min={1} max={730}
                    value={maxContinuousDays}
                    onChange={(e) => setMaxContinuousDays(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Min service (months)</span>
                  <input
                    type="number" min={0}
                    value={minServiceMonths}
                    onChange={(e) => setMinServiceMonths(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Gender restriction</span>
                  <select
                    value={genderRestriction}
                    onChange={(e) => setGenderRestriction(e.target.value as "" | "male" | "female")}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  >
                    <option value="">None</option>
                    <option value="female">Female only (e.g. Maternity)</option>
                    <option value="male">Male only (e.g. Paternity)</option>
                  </select>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Med cert required after (days)</span>
                  <input
                    type="number" min={1}
                    value={requiresMedicalCertAfterDays}
                    onChange={(e) => setRequiresMedicalCertAfterDays(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 20 }}>
                {[
                  { label: "Carry forward", value: carryForward, set: setCarryForward },
                  { label: "Encashable", value: encashable, set: setEncashable },
                  { label: "Requires medical certificate", value: requiresMedicalCert, set: setRequiresMedicalCert },
                  { label: "Prefix/suffix rule", value: prefixSuffixRule, set: setPrefixSuffixRule },
                  { label: "Sandwich rule", value: sandwichRule, set: setSandwichRule },
                  { label: "Pro-rata on joining", value: proRataOnJoining, set: setProRataOnJoining },
                ].map(({ label, value, set }) => (
                  <label key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => set(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: "var(--primary-d)" }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </details>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="submit" className="btn primary">
                Create Policy
              </button>
              <button type="button" className="btn ghost" onClick={() => { setOpen(false); setFieldError(null); }}>
                Cancel
              </button>
            </div>
          </Card>
        </form>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Create leave policy?"
        confirmLabel="Create policy"
        busy={busy}
        errorMessage={error}
        description={
          selectedLt ? (
            <>
              Create a new <strong>{selectedLt.name}</strong> policy for{" "}
              <strong style={{ textTransform: "capitalize" }}>{employeeType.replace(/_/g, " ")}</strong>{" "}
              employees granting <strong>{maxDaysPerYear} days/year</strong>.
            </>
          ) : (
            "Create this leave policy."
          )
        }
        onConfirm={() => void save()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}
