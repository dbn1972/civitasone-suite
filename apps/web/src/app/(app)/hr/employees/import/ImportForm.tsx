"use client";

import { useRef, useState } from "react";

/**
 * Bulk CSV import form — parses the file client-side, validates rows, then
 * submits them to the backend in batches. Shows progress and error summary.
 */
export function ImportForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ total: 0, success: 0, failed: 0 });
  const [errors, setErrors] = useState<string[]>([]);

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

    // Parse rows
    const rows = lines.slice(1).map((line, idx) => {
      const vals = line.split(",").map((v) => v.trim().replace(/^"/, "").replace(/"$/, ""));
      const obj: Record<string, string> & { lineNo: number } = { lineNo: idx + 2 } as any;
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
      return obj;
    });

    setStatus("uploading");
    setProgress({ total: rows.length, success: 0, failed: 0 });
    const errs: string[] = [];
    let success = 0;

    // Submit in batches of 5
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      await Promise.all(batch.map(async (row) => {
        try {
          const body = {
            employeeNo: row.employeeNo,
            fullName: row.fullName,
            email: row.email || undefined,
            mobile: row.mobile || undefined,
            departmentId: row.departmentCode, // backend resolves code→id
            designationId: row.designationCode,
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
          else { errs.push(`Row ${row.lineNo} (${row.fullName}): ${res.status}`); }
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
