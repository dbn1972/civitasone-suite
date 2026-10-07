"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormError } from "@/lib/useFormError";
import { estimatedValueRupees } from "./estimatedValueRupees";
import { PageHeader, Button } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYearStart, fyLabel } from "@/lib/financialYear";
import { METHOD_LABELS } from "@/lib/procurementLabels";

// GAP-PROCUREMENT-PLANNING-NEW-01: planYear is the FY START year. Defaulting via
// `new Date().getFullYear() + 1` mis-filed plans in Jan–Mar. The field is now a
// <select> seeded from the real IST financial year with a visible "FY 2027-28"
// label. DECISION: default to the NEXT financial year (currentFY + 1), because an
// *annual* procurement plan is prepared ahead of the year it governs; the full
// current-1..current+2 range is offered so a late/current-year plan is still one click.
const CATEGORY_OPTIONS = [
  { value: "goods", label: "Goods" },
  { value: "services", label: "Services" },
  { value: "works", label: "Works" },
] as const;
const PROCUREMENT_METHODS = Object.keys(METHOD_LABELS);
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

type PlanLine = {
  itemCode: string;
  description: string;
  quantity: number;
  uom: string;
  estimatedValueMinor: number;
  procurementCategory: string;
  budgetLine: string;
  procurementMethod: string;
  timelineQuarter: string;
};

function emptyLine(): PlanLine {
  return {
    itemCode: "",
    description: "",
    quantity: 1,
    uom: "nos",
    estimatedValueMinor: 0,
    procurementCategory: "goods",
    budgetLine: "",
    procurementMethod: "gem",
    timelineQuarter: "Q1",
  };
}

export default function NewAnnualPlanPage() {
  const router = useRouter();
  const currentFy = currentFinancialYearStart();
  const fyOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = currentFy - 1; y <= currentFy + 2; y++) out.push(y);
    return out;
  }, [currentFy]);
  // Default to the next financial year (see DECISION above).
  const [planYear, setPlanYear] = useState<string>(String(currentFy + 1));
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PlanLine[]>([emptyLine()]);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "accepted" | "error"
  >("idle");
  /** Client-authored copy for pre-submit validation and success — never server text. */
  const [clientMessage, setClientMessage] = useState("");
  const formError = useFormError("annual procurement plan");

  function updateLine(i: number, patch: Partial<PlanLine>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }

  // GAP-PROCUREMENT-PLANNING-NEW-04: show the plan total (sum of valid line
  // values) in BigInt paise, so the user sees it before submit with no drift.
  const totalMinor = useMemo(
    () =>
      lines.reduce((s, l) => s + BigInt(Math.max(0, Math.round(l.estimatedValueMinor))), 0n),
    [lines],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !department.trim() || !planYear) {
      setStatus("error");
      setClientMessage("Year, title, and department are required.");
      return;
    }
    // GAP-PROCUREMENT-PLANNING-NEW-04: never POST an empty/all-blank lines array.
    const validLines = lines.filter((l) => l.itemCode.trim() && l.description.trim());
    if (validLines.length === 0) { // ux-001-ok: form-validation of user-entered lines, not a loader empty state
      setStatus("error");
      setClientMessage("Add at least one line item (item code and description).");
      return;
    }
    setStatus("submitting");
    setClientMessage("");
    formError.clear();
    try {
      const res = await fetch("/api/proxy/v1/procurement/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planYear: parseInt(planYear, 10),
          title: title.trim(),
          department: department.trim(),
          notes: notes.trim() || undefined,
          // GAP-PROCUREMENT-PLANNING-NEW-03: build each line explicitly — no
          // object spread (which leaked a stray `quantity` key) and no
          // hard-coded procurementCategory "goods" for every row.
          lines: validLines.map((l) => ({
            itemCode: l.itemCode.trim(),
            description: l.description.trim(),
            aggregatedQty: l.quantity,
            uom: l.uom.trim() || "nos",
            estimatedValueMinor: Math.max(0, Math.round(l.estimatedValueMinor)),
            procurementCategory: l.procurementCategory,
            procurementMethod: l.procurementMethod,
            timelineQuarter: l.timelineQuarter,
            ...(l.budgetLine.trim() ? { budgetLine: l.budgetLine.trim() } : {}),
          })),
        }),
      });
      if (!res.ok) {
        setStatus("error");
        await formError.fromResponse(res, "save");
        return;
      }
      setStatus("accepted");
      // GAP-PROCUREMENT-PLANNING-NEW-05: the plan is created as a DRAFT, not
      // submitted for approval — say so, and open the new plan if we got an id.
      setClientMessage("Plan saved as draft. Open it to submit for approval.");
      let newId: string | null = null;
      try {
        const body = (await res.json()) as { id?: string; data?: { id?: string } };
        newId = body?.data?.id ?? body?.id ?? null;
      } catch {
        newId = null;
      }
      setTimeout(
        () => router.push(newId ? `/procurement/planning/${newId}` : "/procurement/planning"),
        1200,
      );
    } catch (caught) {
      setStatus("error");
      formError.fromException("save", caught);
    }
  }

  return (
    <div className="page-main wrap">
      <div style={{ maxWidth: 980 }}>
        <PageHeader
          title="New Annual Procurement Plan"
          subtitle="GFR 2017 — Aggregated demand for a financial year"
          back="/procurement/planning"
          backLabel="Plans"
          help="procurement"
        />

        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="card pad" style={{ marginBottom: 16 }}>
            <div className="fields">
              <div className="field">
                <label className="label" htmlFor="planYear">
                  Financial year *
                </label>
                <select
                  id="planYear"
                  className="inp"
                  value={planYear}
                  onChange={(e) => setPlanYear(e.target.value)}
                  style={{ minHeight: 44 }}
                  required
                >
                  {fyOptions.map((y) => (
                    <option key={y} value={y}>
                      {fyLabel(y)}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Plan for {fyLabel(parseInt(planYear, 10))}
                </span>
                {formError.fieldError("planYear") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>
                    {formError.fieldError("planYear")}
                  </span>
                )}
              </div>
              <div className="field">
                <label className="label" htmlFor="dept">
                  Department *
                </label>
                <input
                  id="dept"
                  className="inp"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  style={{ minHeight: 44 }}
                  required
                />
                {/* GAP-PROCUREMENT-PLANNING-NEW-02: there is no org/department
                    master endpoint in this service, and the session identity does
                    not expose the user's department, so a canonical picker cannot
                    be wired without inventing a master (out of proportion).
                    DECISION: keep a free-text field with server-side zod
                    validation; a department master + picker (and defaulting from
                    the user's own department) is a separate, larger piece of work
                    recorded for HUMAN REVIEW. */}
                {formError.fieldError("department") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>
                    {formError.fieldError("department")}
                  </span>
                )}
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label className="label" htmlFor="title">
                  Plan title *
                </label>
                <input
                  id="title"
                  className="inp"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{ minHeight: 44 }}
                  required
                />
                {formError.fieldError("title") && (
                  <span style={{ fontSize: 12, color: "var(--bad)" }}>
                    {formError.fieldError("title")}
                  </span>
                )}
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label className="label" htmlFor="notes">
                  Notes
                </label>
                <textarea
                  id="notes"
                  className="inp"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card pad" style={{ marginBottom: 16 }}>
            <h2
              style={{
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 12,
                color: "var(--ink)",
              }}
            >
              Line items
            </h2>
            <div className="tbl-wrap">
              <table className="tbl" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th scope="col">Item code</th>
                    <th scope="col">Description</th>
                    <th scope="col">Category</th>
                    <th scope="col">Budget line</th>
                    <th scope="col" style={{ textAlign: "end" }}>
                      Qty
                    </th>
                    <th scope="col">UoM</th>
                    <th scope="col" style={{ textAlign: "end" }}>
                      Est. value (INR)
                    </th>
                    <th scope="col">Method</th>
                    <th scope="col">Quarter</th>
                    <th scope="col" aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="inp"
                          aria-label={`Item code, line ${i + 1}`}
                          value={l.itemCode}
                          onChange={(e) =>
                            updateLine(i, { itemCode: e.target.value })
                          }
                          style={{ minWidth: 100 }}
                        />
                      </td>
                      <td>
                        <input
                          className="inp"
                          aria-label={`Description, line ${i + 1}`}
                          value={l.description}
                          onChange={(e) =>
                            updateLine(i, { description: e.target.value })
                          }
                          style={{ minWidth: 160 }}
                        />
                      </td>
                      <td>
                        <select
                          className="inp"
                          aria-label={`Category, line ${i + 1}`}
                          value={l.procurementCategory}
                          onChange={(e) =>
                            updateLine(i, { procurementCategory: e.target.value })
                          }
                        >
                          {CATEGORY_OPTIONS.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="inp"
                          aria-label={`Budget line, line ${i + 1}`}
                          value={l.budgetLine}
                          onChange={(e) =>
                            updateLine(i, { budgetLine: e.target.value })
                          }
                          style={{ minWidth: 120 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="inp"
                          aria-label={`Quantity, line ${i + 1}`}
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(i, {
                              quantity: Math.max(
                                1,
                                parseInt(e.target.value) || 1,
                              ),
                            })
                          }
                          style={{ width: 70, textAlign: "end" }}
                        />
                      </td>
                      <td>
                        <input
                          className="inp"
                          aria-label={`Unit of measure, line ${i + 1}`}
                          value={l.uom}
                          onChange={(e) =>
                            updateLine(i, { uom: e.target.value })
                          }
                          style={{ width: 60 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="inp"
                          aria-label={`Estimated value INR, line ${i + 1}`}
                          value={estimatedValueRupees(l.estimatedValueMinor)}
                          onChange={(e) =>
                            updateLine(i, {
                              estimatedValueMinor: Math.round(
                                (parseFloat(e.target.value) || 0) * 100,
                              ),
                            })
                          }
                          style={{ width: 120, textAlign: "end" }}
                          step="0.01"
                        />
                      </td>
                      <td>
                        <select
                          className="inp"
                          aria-label={`Procurement method, line ${i + 1}`}
                          value={l.procurementMethod}
                          onChange={(e) =>
                            updateLine(i, { procurementMethod: e.target.value })
                          }
                        >
                          {PROCUREMENT_METHODS.map((m) => (
                            <option key={m} value={m}>
                              {METHOD_LABELS[m] ?? m}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="inp"
                          aria-label={`Timeline quarter, line ${i + 1}`}
                          value={l.timelineQuarter}
                          onChange={(e) =>
                            updateLine(i, { timelineQuarter: e.target.value })
                          }
                        >
                          {QUARTERS.map((q) => (
                            <option key={q} value={q}>
                              {q}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <Button
                          type="button"
                          onClick={() =>
                            setLines((prev) => prev.filter((_, j) => j !== i))
                          }
                          variant="ghost"
                          size="sm"
                          style={{ fontSize: 12, padding: "2px 8px" }}
                          aria-label="Remove line"
                          // GAP-PROCUREMENT-PLANNING-NEW-04: never allow removing
                          // the last line — a plan must keep at least one row.
                          disabled={lines.length === 1}
                        >
                          ✕
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ textAlign: "end", fontWeight: 600 }}>
                      Plan total
                    </td>
                    <td style={{ textAlign: "end", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {formatMoney(totalMinor.toString())}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <Button
              type="button"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
              variant="ghost"
              size="sm"
              style={{ marginTop: 12, fontSize: 13 }}
            >
              + Add line
            </Button>
          </div>

          {clientMessage ? (
            <p
              role={status === "error" ? "alert" : "status"}
              style={{
                marginBottom: 12,
                color: status === "error" ? "var(--bad)" : "var(--good)",
                fontSize: 13,
              }}
            >
              {clientMessage}
            </p>
          ) : null}
          {formError.message ? (
            <p
              role="alert"
              style={{ marginBottom: 12, color: "var(--bad)", fontSize: 13 }}
            >
              {formError.message}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              type="submit"
              variant="primary"
              style={{ minHeight: 44 }}
              disabled={status === "submitting"}
            >
              {status === "submitting" ? "Creating…" : "Create plan"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              style={{ minHeight: 44 }}
              onClick={() => router.push("/procurement/planning")}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
