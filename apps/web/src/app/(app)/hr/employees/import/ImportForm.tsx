"use client";

import { useRef, useState } from "react";

type Row = Record<string, string> & { lineNo: number };

/**
 * Bulk CSV import form — parses the file client-side, validates rows, then
 * submits them to the backend in batches. Shows progress and error summary.
 *
 * departmentId/designationId on POST /v1/hrms/employees are strict UUIDs
 * (createEmployeeBody in hrms-service) — there is no code-based resolution
 * on the server at all (confirmed: no /import route of any kind exists in
 * the employee module, and a live POST with departmentId:"FIN" returns 400
 * {"field":"departmentId","message":"Invalid uuid"}). The CSV template this
 * page hands out uses human codes like "FIN"/"JC" in departmentCode /
 * designationCode, so every previous version of this form sent those codes
 * straight through as the id fields — every single row of every import
 * failed, always, with an opaque "400" and no explanation why. Fixed by
 * resolving codes to ids client-side against the same masters lists the
 * rest of HR already uses, with a clear per-row error when a code isn't
 * found (rather than a bare status code).
 */
export function ImportForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ total: 0, success: 0, failed: 0 });
  const [errors, setErrors] = useState<string[]>([]);

  async function loadCodeMap(path: string): Promise<Map<string, string>> {
    const res = await fetch(path);
    if (!res.ok) return new Map();
    const body = (await res.json()) as { data?: { id: string; code: string }[] } | { id: string; code: string }[];
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setStatus("error"); setErrors(["Please select a CSV file."]); return; }

    setStatus("parsing");
    setErrors([]);
    const text = await file.text();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) { setStatus("error"); setErrors(["CSV must have a header row + at least one data row."]); return; }

    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"/, "").replace(/"$/, ""));
    const requiredCols = ["employeeNo", "fullName", "departmentCode", "designationCode", "employeeType", "dateOfJoining", "basicPay"];
    const missing = requiredCols.filter((c) => !headers.includes(c));
    if (missing.length) { setStatus("error"); setErrors([`Missing columns: ${missing.join(", ")}`]); return; }

    // Parse rows. `lineNo` (number) deliberately sits alongside the
    // Record<string, string> CSV-column fields, which the index signature
    // can't express — building it as `any` here is the narrowest way to
    // bridge that, matching how this file already handled it.
    const rows: Row[] = lines.slice(1).map((line, idx) => {
      const vals = line.split(",").map((v) => v.trim().replace(/^"/, "").replace(/"$/, ""));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = { lineNo: idx + 2 } as any;
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
      return obj as Row;
    });

    const [deptByCode, desigByCode] = await Promise.all([
      loadCodeMap("/api/proxy/v1/hrms/departments"),
      loadCodeMap("/api/proxy/v1/hrms/designations"),
    ]);

    setStatus("uploading");
    setProgress({ total: rows.length, success: 0, failed: 0 });
    const errs: string[] = [];
    let success = 0;

    // Submit in batches of 5
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      await Promise.all(batch.map(async (row) => {
        const departmentId = deptByCode.get(row.departmentCode);
        const designationId = desigByCode.get(row.designationCode);
        if (!departmentId || !designationId) {
          const bad = [!departmentId && `department code "${row.departmentCode}"`, !designationId && `designation code "${row.designationCode}"`]
            .filter(Boolean).join(" and ");
          errs.push(`Row ${row.lineNo} (${row.fullName}): unknown ${bad} — check spelling against the Departments/Designations pages.`);
          return;
        }
        try {
          const body = {
            employeeNo: row.employeeNo,
            fullName: row.fullName,
            email: row.email || undefined,
            mobile: row.mobile || undefined,
            departmentId,
            designationId,
            employeeType: row.employeeType || "permanent",
            dateOfJoining: row.dateOfJoining,
            basicMinor: Math.round(Number(row.basicPay || 0) * 100),
            gender: row.gender || undefined,
            currency: "INR",
          };
          const res = await fetch("/api/proxy/v1/hrms/employees", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok || res.status === 202) { success++; }
          else {
            const text2 = await res.text();
            errs.push(`Row ${row.lineNo} (${row.fullName}): ${text2 || `request failed (${res.status})`}`);
          }
        } catch {
          errs.push(`Row ${row.lineNo} (${row.fullName}): network error`);
        }
      }));
      setProgress({ total: rows.length, success, failed: errs.length });
    }

    setErrors(errs);
    setStatus("done");
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        <label htmlFor="import-csv-file" style={{ fontSize: 13, fontWeight: 500, color: "var(--fg, #0f172a)" }}>
          CSV File <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          ref={fileRef}
          id="import-csv-file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby="import-csv-hint"
        />
        <p id="import-csv-hint" style={{ fontSize: 12, color: "var(--mut, #64748b)", margin: 0 }}>
          Required columns: employeeNo, fullName, departmentCode, designationCode, employeeType, dateOfJoining, basicPay
        </p>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="btn primary" disabled={status === "uploading"} style={{ minHeight: 44 }}>
          {status === "uploading" ? `Importing… (${progress.success}/${progress.total})` : "Upload & Import"}
        </button>
        {status === "done" && (
          <span style={{ fontSize: 13, color: progress.failed === 0 ? "#166534" : "#b91c1c" }}>
            ✅ {progress.success} imported{progress.failed > 0 ? `, ❌ ${progress.failed} failed` : ""}
          </span>
        )}
      </div>
      {errors.length > 0 && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", fontSize: 12.5, color: "#b91c1c", maxHeight: 200, overflow: "auto" }}>
          {errors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}
    </form>
  );
}
