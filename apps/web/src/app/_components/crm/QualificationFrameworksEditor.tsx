"use client";
/**
 * QualificationFrameworksEditor — LQ-001 admin. CRUD for per-business-line
 * qualification frameworks and their questions. GET on mount; each framework
 * card saves independently (POST when new, PUT when it has an id) and can be
 * deleted behind a ConfirmDialog. On a failed load we show the saved-info badge
 * and never fabricate an empty framework set as fact (source==="error").
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { z } from "zod";
import { DataSourceBadge } from "../DataSourceBadge";
import { ConfirmDialog, EmptyState, Button } from "../ds";
import {
  getFrameworks,
  createFramework,
  updateFramework,
  FrameworkConflictError,
  QuestionHasAnswersError,
  deleteFramework,
  type QualificationFramework,
  type QualQuestion,
  type LqSource,
} from "@/lib/crm/leadQualification";

const inputStyle = { width: "100%", padding: 8, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

/**
 * GAP-CRM-QUALIFICATION-FRAMEWORKS-03: a zod schema at the form boundary,
 * mirroring services/crm-service leads/qualification-validators.ts (name/line
 * required; at least one question; each question needs non-empty trimmed text
 * and an integer weight 0–100). The server stays authoritative; this stops an
 * empty question text or a blank/NaN weight being POSTed (and then silently
 * dropped / coerced to 0).
 */
function makeFrameworkSchema(t: ReturnType<typeof useTranslations>) {
  const questionSchema = z.object({
    text: z.string().trim().min(1, t("questionTextRequired")),
    weight: z.number({ invalid_type_error: t("weightRequired") }).int(t("weightWhole")).min(0, t("weightRange")).max(100, t("weightRange")),
  });
  return z.object({
    name: z.string().trim().min(1, t("nameRequired")),
    businessLine: z.string().trim().min(1, t("businessLineRequired")),
    questions: z.array(questionSchema).min(1, t("addAtLeastOneQuestion")),
  });
}

/**
 * Parse a weight input. A blank/non-numeric entry becomes NaN (an explicit
 * "not set") rather than silently 0, so the schema can reject it on save; a
 * valid number is rounded and clamped to the backend's 0–100 integer range.
 */
function parseWeight(raw: string): number {
  if (raw.trim() === "") return NaN;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return NaN;
  return Math.min(100, Math.max(0, n));
}

function blankFramework(): QualificationFramework {
  return { name: "", businessLine: "", active: true, questions: [] };
}

export function QualificationFrameworksEditor() {
  const t = useTranslations("crmQualificationFrameworksEditor");
  const formError = useFormError("framework");
  const [frameworks, setFrameworks] = useState<QualificationFramework[]>([]);
  const [source, setSource] = useState<LqSource | "loading">("loading");
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // True after a 409 VERSION_CONFLICT: offer a one-click reload of the latest version.
  const [stale, setStale] = useState(false);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  // GAP-CRM-QUALIFICATION-FRAMEWORKS-03: per-question validation messages for the
  // framework currently being saved (scoped to that framework's index).
  const [fieldErrors, setFieldErrors] = useState<{ fi: number; q: Record<number, string> } | null>(null);
  const headingId = useId();

  // Stable per-row React keys, independent of array position -- see
  // ElectFlexBenefitForm.tsx (apps/web/src/app/(app)/hr/payroll/flex-benefits)
  // for the full rationale. Two levels here:
  //  - Outer (frameworks): a saved framework already keys on its real
  //    `fw.id`; only an unsaved draft (no id yet) fell back to the array
  //    index, so removing one unsaved draft while a later one was focused
  //    shifted it into the removed draft's key.
  //  - Inner (questions): QualQuestion carries no id at all, so every
  //    framework's question list was fully index-keyed.
  // Both carry no server/domain id suitable to send back to the API, so
  // parallel id lists (regenerated whenever load() replaces the whole
  // frameworks array, and kept in step by the mutators below) stand in.
  const nextFrameworkRowId = useRef(0);
  const [frameworkRowIds, setFrameworkRowIds] = useState<number[]>([]);
  const frameworkKeyFor = (fi: number) => frameworkRowIds[fi] ?? fi;

  const nextQuestionRowId = useRef(0);
  const [questionRowIds, setQuestionRowIds] = useState<number[][]>([]);
  const questionKeyFor = (fi: number, qi: number) => questionRowIds[fi]?.[qi] ?? qi;

  // GAP-CRM-QUALIFICATION-FRAMEWORKS-06: after + Add framework the new card is
  // appended at the end of a potentially long list; scroll it into view and
  // focus its Name input so the user gets clear feedback. Keyed on the stable
  // framework row id (not the array index, which other mutations shift).
  const nameInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const [pendingFocusRowId, setPendingFocusRowId] = useState<number | null>(null);
  const [addAnnouncement, setAddAnnouncement] = useState("");

  useEffect(() => {
    if (pendingFocusRowId === null) return;
    const el = nameInputRefs.current.get(pendingFocusRowId);
    if (el) {
      if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
      el.focus();
    }
    setPendingFocusRowId(null);
  }, [pendingFocusRowId, frameworkRowIds]);

  function addFramework() {
    const newRowId = nextFrameworkRowId.current++;
    setFrameworks((prev) => [...prev, blankFramework()]);
    setFrameworkRowIds((ids) => [...ids, newRowId]);
    setQuestionRowIds((ids) => [...ids, []]);
    setMessage("");
    setError("");
    setAddAnnouncement(t("added"));
    setPendingFocusRowId(newRowId);
  }

  async function load(isLive: () => boolean = () => true) {
    setSource("loading");
    const { data, source: s } = await getFrameworks();
    if (!isLive()) return;
    setFrameworks(data);
    setFrameworkRowIds(data.map(() => nextFrameworkRowId.current++));
    setQuestionRowIds(data.map((f) => f.questions.map(() => nextQuestionRowId.current++)));
    setSource(s);
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => { live = false; };
  }, []);

  function update(idx: number, patch: Partial<QualificationFramework>) {
    setFrameworks((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }

  function updateQuestion(fi: number, qi: number, patch: Partial<QualQuestion>) {
    setFrameworks((prev) =>
      prev.map((f, i) =>
        i === fi ? { ...f, questions: f.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) } : f,
      ),
    );
  }

  function addQuestion(fi: number) {
    setFrameworks((prev) =>
      prev.map((f, i) => (i === fi ? { ...f, questions: [...f.questions, { text: "", weight: 1 }] } : f)),
    );
    setQuestionRowIds((prev) => prev.map((ids, i) => (i === fi ? [...ids, nextQuestionRowId.current++] : ids)));
  }

  function removeQuestion(fi: number, qi: number) {
    setFrameworks((prev) =>
      prev.map((f, i) => (i === fi ? { ...f, questions: f.questions.filter((_, j) => j !== qi) } : f)),
    );
    setQuestionRowIds((prev) => prev.map((ids, i) => (i === fi ? ids.filter((_, j) => j !== qi) : ids)));
  }

  async function save(idx: number) {
    setMessage("");
    setError("");
    setStale(false);
    setFieldErrors(null);
    // GAP-CRM-QUALIFICATION-FRAMEWORKS-04: business line is an open vocabulary (no
    // canonical list exists in web or crm-service). Normalise it (trim + lowercase)
    // on save so a case/whitespace typo doesn't silently stop the framework matching
    // a lead; getFrameworks() lowercases the query the same way.
    const normalisedLine = frameworks[idx].businessLine.trim().toLowerCase();
    const fw = { ...frameworks[idx], businessLine: normalisedLine };
    if (normalisedLine !== frameworks[idx].businessLine) {
      update(idx, { businessLine: normalisedLine });
    }
    const parsed = makeFrameworkSchema(t).safeParse(fw);
    if (!parsed.success) {
      // Map issues to a per-question message where possible; show the first
      // framework-level issue as the headline error.
      const qErrors: Record<number, string> = {};
      let headline = "";
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "questions" && typeof issue.path[1] === "number") {
          qErrors[issue.path[1] as number] = issue.message;
        } else if (!headline) {
          headline = issue.message;
        }
      }
      setFieldErrors({ fi: idx, q: qErrors });
      setError(headline || t("fixHighlighted"));
      return;
    }
    setBusyIdx(idx);
    try {
      if (fw.id) await updateFramework(fw.id, fw);
      else await createFramework(fw);
      setMessage(t("saved", { name: fw.name }));
      await load();
    } catch (e) {
      // 409s carry a plain-language message (changed by someone else / in-use question).
      setError(
        e instanceof FrameworkConflictError
          ? t("conflict")
          : e instanceof QuestionHasAnswersError
            ? t("questionHasAnswers")
            : formError.fromException("save", e).message,
      );
      setStale(e instanceof FrameworkConflictError);
    } finally {
      setBusyIdx(null);
    }
  }

  async function confirmDelete(idx: number) {
    const fw = frameworks[idx];
    setMessage("");
    setError("");
    if (!fw.id) {
      // Unsaved draft — just drop it from the list.
      setFrameworks((prev) => prev.filter((_, i) => i !== idx));
      setFrameworkRowIds((ids) => ids.filter((_, i) => i !== idx));
      setQuestionRowIds((ids) => ids.filter((_, i) => i !== idx));
      setConfirmIdx(null);
      return;
    }
    setBusyIdx(idx);
    try {
      await deleteFramework(fw.id);
      setMessage(`Framework "${fw.name}" deleted.`);
      setConfirmIdx(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the framework.");
    } finally {
      setBusyIdx(null);
    }
  }

  if (source === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        Loading qualification frameworks…
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-h">
          <h3 id={headingId}>Qualification frameworks</h3>
          {source === "error" ? <DataSourceBadge source="error" /> : null}
        </div>
        {message ? <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>{message}</p> : null}
        {error ? <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>{error}</p> : null}
        {stale ? (
          <div style={{ padding: "0 12px 8px" }}>
            <Button type="button" onClick={() => { setStale(false); setError(""); void load(); }}>
              {t("reloadLatest")}
            </Button>
          </div>
        ) : null}
        {/* GAP-CRM-QUALIFICATION-FRAMEWORKS-04: suggest the business lines already in
            use so admins reuse an existing canonical value instead of typing a variant. */}
        <datalist id={`${headingId}-bl-options`}>
          {Array.from(new Set(frameworks.map((f) => f.businessLine.trim()).filter((b) => b.length > 0)))
            .sort()
            .map((b) => (
              <option key={b} value={b} />
            ))}
        </datalist>
        <div className="pad">
          <Button
            type="button"
            variant="ghost"
            onClick={addFramework}
          >
            + Add framework
          </Button>
          {addAnnouncement ? (
            <span role="status" aria-live="polite" className="sr-only">{addAnnouncement}</span>
          ) : null}
        </div>
      </div>

      {frameworks.length === 0 ? (
        <EmptyState
          icon="🧭"
          title="No frameworks yet"
          message="Add a qualification framework for a business line, then add the questions that decide whether a lead qualifies."
        />
      ) : (
        frameworks.map((fw, fi) => (
          <div className="card" key={fw.id ?? frameworkKeyFor(fi)} aria-label={`Framework ${fi + 1}`}>
            <div className="pad" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                <div>
                  <label htmlFor={`${headingId}-name-${fi}`} style={labelStyle}>Name</label>
                  <input
                    id={`${headingId}-name-${fi}`}
                    ref={(el) => {
                      const rowId = frameworkKeyFor(fi);
                      if (el) nameInputRefs.current.set(rowId, el);
                      else nameInputRefs.current.delete(rowId);
                    }}
                    value={fw.name}
                    onChange={(e) => update(fi, { name: e.target.value })}
                    placeholder={t("namePlaceholder")}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label htmlFor={`${headingId}-bl-${fi}`} style={labelStyle}>Business line</label>
                  <input id={`${headingId}-bl-${fi}`} list={`${headingId}-bl-options`} value={fw.businessLine} onChange={(e) => update(fi, { businessLine: e.target.value })} placeholder={t("businessLinePlaceholder")} style={inputStyle} />
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    {t("businessLineHelp")}
                  </span>
                </div>
                <div>
                  <label style={{ ...labelStyle, marginTop: 24 }}>
                    <input type="checkbox" checked={fw.active} onChange={(e) => update(fi, { active: e.target.checked })} style={{ marginInlineEnd: 6 }} />
                    Active
                  </label>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h4 style={{ margin: "8px 0" }}>Questions</h4>
                  <Button type="button" variant="ghost" size="sm" onClick={() => addQuestion(fi)}>+ Add question</Button>
                </div>
                {fw.questions.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--muted)" }}>No questions yet.</p>
                ) : (
                  (() => {
                    // Weights are relative, not a running total out of 100 — two
                    // admins can build frameworks summing to 60 and 240 with no
                    // cue. Show the sum and each question's share of it so the
                    // relative impact is visible. A zero total means no question
                    // can ever move the score, so warn (non-blocking).
                    const totalWeight = fw.questions.reduce(
                      (sum, q) => sum + (Number.isFinite(q.weight) ? q.weight : 0),
                      0,
                    );
                    const sharePct = (w: number) =>
                      totalWeight > 0 && Number.isFinite(w) ? Math.round((w / totalWeight) * 1000) / 10 : 0;
                    return (
                      <>
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th>{t("colQuestion")}</th>
                              <th style={{ textAlign: "end" }}>{t("colWeight")}</th>
                              <th style={{ textAlign: "end" }}>{t("colShare")}</th>
                              <th><span className="sr-only">{t("colActions")}</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {fw.questions.map((q, qi) => {
                              const qError = fieldErrors && fieldErrors.fi === fi ? fieldErrors.q[qi] : undefined;
                              return (
                              <tr key={q.id ?? questionKeyFor(fi, qi)}>
                                <td>
                                  <label className="sr-only" htmlFor={`${headingId}-q-${fi}-${qi}`}>{t("questionTextLabel", { n: qi + 1 })}</label>
                                  <input id={`${headingId}-q-${fi}-${qi}`} value={q.text} aria-invalid={qError ? true : undefined} onChange={(e) => updateQuestion(fi, qi, { text: e.target.value })} style={inputStyle} />
                                  {qError ? <p role="alert" style={{ fontSize: 11, color: "#b42318", margin: "4px 0 0" }}>{qError}</p> : null}
                                </td>
                                <td className="num">
                                  <label className="sr-only" htmlFor={`${headingId}-w-${fi}-${qi}`}>{t("questionWeightLabel", { n: qi + 1 })}</label>
                                  <input
                                    id={`${headingId}-w-${fi}-${qi}`}
                                    type="number" min={0} max={100} step={1}
                                    value={Number.isFinite(q.weight) ? q.weight : ""}
                                    aria-invalid={Number.isFinite(q.weight) && !qError ? undefined : true}
                                    onChange={(e) => updateQuestion(fi, qi, { weight: parseWeight(e.target.value) })}
                                    style={{ width: 80, padding: 6, minHeight: 40, borderRadius: 8, border: "1px solid var(--line)", textAlign: "end" }}
                                  />
                                </td>
                                <td className="num" aria-label={t("questionShareAria", { n: qi + 1 })} style={{ color: "var(--muted)", fontSize: 13 }}>
                                  {totalWeight > 0 ? `${sharePct(q.weight)}%` : "—"}
                                </td>
                                <td>
                                  <Button type="button" variant="ghost" size="sm" onClick={() => removeQuestion(fi, qi)} aria-label={t("removeQuestionAria", { n: qi + 1 })}>{t("remove")}</Button>
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <th scope="row" style={{ textAlign: "start" }}>
                                {t("totalWeight")}
                                <span style={{ display: "block", fontWeight: 400, fontSize: 12, color: "var(--muted)" }}>
                                  {t("weightsRelative", { total: totalWeight })}
                                </span>
                              </th>
                              <td className="num" aria-label={t("totalWeightValueAria")}>{totalWeight}</td>
                              <td className="num" style={{ color: "var(--muted)", fontSize: 13 }}>{totalWeight > 0 ? "100%" : "—"}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                        {totalWeight === 0 ? (
                          <p role="status" style={{ fontSize: 13, color: "#b45309", marginTop: 6 }}>
                            {t("zeroTotalWarning")}
                          </p>
                        ) : null}
                      </>
                    );
                  })()
                )}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button type="button" disabled={busyIdx === fi} onClick={() => void save(fi)}>
                  {busyIdx === fi ? "Saving…" : "Save framework"}
                </Button>
                <Button type="button" variant="danger" disabled={busyIdx === fi} onClick={() => setConfirmIdx(fi)}>
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))
      )}

      <ConfirmDialog
        open={confirmIdx !== null}
        title="Delete this framework?"
        danger
        description="Removing a qualification framework stops it being offered on lead detail screens. This is recorded in the audit trail."
        confirmLabel="Delete framework"
        busy={busyIdx !== null && busyIdx === confirmIdx}
        onCancel={() => setConfirmIdx(null)}
        onConfirm={() => { if (confirmIdx !== null) void confirmDelete(confirmIdx); }}
      />
    </div>
  );
}
