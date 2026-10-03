"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, Button, ConfirmDialog, useConfirmAction, ErrorState } from "../../../../_components/ds";
import { StatusPill } from "../../../../_components/ds/StatusPill";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { actionsFor, currentStageLabel, parseRequisitions, type Requisition, type RequisitionAction } from "./requisitionView";

/**
 * GAP-RECRUITMENT-NEW-06: requisition list + create + approval-chain actions + Publish, on the existing
 * /v1/hrms/requisitions routes. A fully approved requisition is published into a vacancy (R-RA-0056) -- the only
 * way to create one in a requisition-first (Govt) edition. Every action is re-validated server-side (state, stage
 * role, maker-checker); writes are queued, so the list is re-read now and once more shortly after.
 */

type Named = { id: string; name: string };
type LoadState = "loading" | "ready" | "error";

const RELOAD_AFTER_WRITE_MS = 1200;
const fieldStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, border: "1.5px solid var(--line)", borderRadius: "var(--r-sm)", background: "var(--panel)", color: "var(--ink)", minHeight: 44 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 };

async function fetchNamed(url: string): Promise<Named[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Named[] } | Named[];
    const list = Array.isArray(body) ? body : body.data;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

export function RequisitionsClient() {
  const t = useTranslations("recruitmentRequisitions");
  const formError = useFormError("requisition");
  const uid = useId();
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<Requisition[]>([]);
  const [departments, setDepartments] = useState<Named[]>([]);
  const [designations, setDesignations] = useState<Named[]>([]);
  const [publishedIds, setPublishedIds] = useState<Record<string, string>>({});

  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [vacancies, setVacancies] = useState("1");
  const [qualification, setQualification] = useState("");
  const [reason, setReason] = useState("");
  const [createState, setCreateState] = useState<"idle" | "saving" | "error" | "saved">("idle");
  const [createMessage, setCreateMessage] = useState("");

  const [pending, setPending] = useState<{ id: string; no: string; kind: RequisitionAction } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/v1/hrms/requisitions");
      if (!res.ok) { if (mounted.current) setState("error"); return; }
      const list = parseRequisitions(await res.json());
      if (!mounted.current) return;
      if (list === null) { setState("error"); return; }
      setRows(list);
      setState("ready");
    } catch {
      if (mounted.current) setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    void (async () => {
      const [d, g] = await Promise.all([fetchNamed("/api/proxy/v1/hrms/departments?limit=200"), fetchNamed("/api/proxy/v1/hrms/designations?limit=200")]);
      if (!mounted.current) return;
      setDepartments(d ?? []);
      setDesignations(g ?? []);
    })();
  }, [load]);

  const reloadAfterWrite = useCallback(() => {
    void load();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (mounted.current) void load(); }, RELOAD_AFTER_WRITE_MS);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const count = Number(vacancies);
    if (!title.trim() || !departmentId || !Number.isInteger(count) || count < 1) {
      setCreateState("error");
      setCreateMessage(t("createInvalid"));
      return;
    }
    setCreateState("saving");
    setCreateMessage("");
    try {
      const res = await fetch("/api/proxy/v1/hrms/requisitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(), departmentId, vacancies: count,
          designationId: designationId || undefined,
          qualification: qualification.trim() || undefined,
          reason: reason.trim() || undefined,
        }),
      });
      if (!res.ok) { setCreateState("error"); setCreateMessage((await formError.fromResponse(res, "save")).message); return; }
      setCreateState("saved");
      setCreateMessage(t("createdMessage"));
      setTitle(""); setQualification(""); setReason(""); setVacancies("1");
      reloadAfterWrite();
    } catch (caught) {
      setCreateState("error");
      setCreateMessage(formError.fromException("save", caught).message);
    }
  }

  const act = useConfirmAction({
    onConfirm: async (comment) => {
      if (!pending) return;
      const path = pending.kind;
      const text = (comment ?? "").trim();
      const res = await fetch(`/api/proxy/v1/hrms/requisitions/${encodeURIComponent(pending.id)}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(path === "approve" || path === "return" ? { comments: text || undefined } : {}),
      });
      if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
      if (path === "publish") {
        const body = (await res.json()) as { publishedOpeningId?: string };
        if (body.publishedOpeningId) setPublishedIds((prev) => ({ ...prev, [pending.id]: body.publishedOpeningId as string }));
      }
      reloadAfterWrite();
    },
  });

  function ask(r: Requisition, kind: RequisitionAction) {
    setPending({ id: r.id, no: r.requisitionNo, kind });
    act.trigger();
  }

  const kind = pending?.kind ?? "submit";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title={t("newTitle")}>
        <form onSubmit={create} noValidate style={{ display: "grid", gap: 12, maxWidth: 640, padding: "16px 20px" }} aria-label={t("newTitle")}>
          <div>
            <label htmlFor={`${uid}-title`} style={labelStyle}>{t("fieldTitle")}</label>
            <input id={`${uid}-title`} style={fieldStyle} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${uid}-dept`} style={labelStyle}>{t("fieldDepartment")}</label>
            <select id={`${uid}-dept`} style={fieldStyle} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">{t("selectDepartment")}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-desig`} style={labelStyle}>{t("fieldDesignation")}</label>
            <select id={`${uid}-desig`} style={fieldStyle} value={designationId} onChange={(e) => setDesignationId(e.target.value)}>
              <option value="">{t("selectDesignation")}</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-vac`} style={labelStyle}>{t("fieldVacancies")}</label>
            <input id={`${uid}-vac`} type="number" min={1} step={1} style={fieldStyle} value={vacancies} onChange={(e) => setVacancies(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${uid}-qual`} style={labelStyle}>{t("fieldQualification")}</label>
            <input id={`${uid}-qual`} style={fieldStyle} value={qualification} maxLength={1000} onChange={(e) => setQualification(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${uid}-reason`} style={labelStyle}>{t("fieldReason")}</label>
            <textarea id={`${uid}-reason`} style={{ ...fieldStyle, minHeight: 80 }} value={reason} maxLength={4000} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Button type="submit" variant="primary" className="btn-tall" disabled={createState === "saving"}>{createState === "saving" ? t("creating") : t("create")}</Button>
            {createMessage && <span role={createState === "error" ? "alert" : "status"} style={{ fontSize: 13, color: createState === "error" ? "var(--bad)" : "var(--mut)" }}>{createMessage}</span>}
          </div>
        </form>
      </Card>

      <Card title={t("listTitle")}>
        {state === "loading" && <p style={{ padding: "16px 20px", margin: 0, color: "var(--mut)" }} aria-busy="true">{t("loading")}</p>}
        {state === "error" && <ErrorState error={toHumanError("load", { area: "requisitions" })} onRetry={() => { setState("loading"); void load(); }} />}
        {state === "ready" && rows.length === 0 && <p style={{ padding: "16px 20px", margin: 0, color: "var(--mut)" }}>{t("none")}</p>}
        {state === "ready" && rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "start", color: "var(--mut)" }}>
                  <th scope="col" style={{ padding: "8px 12px" }}>{t("colNo")}</th>
                  <th scope="col" style={{ padding: "8px 12px" }}>{t("colTitle")}</th>
                  <th scope="col" style={{ padding: "8px 12px", textAlign: "end" }}>{t("colVacancies")}</th>
                  <th scope="col" style={{ padding: "8px 12px" }}>{t("colStatus")}</th>
                  <th scope="col" style={{ padding: "8px 12px" }}>{t("colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const stage = currentStageLabel(r);
                  const opening = publishedIds[r.id] ?? r.publishedOpeningId ?? null;
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 12px" }}><code style={{ fontSize: 12 }}>{r.requisitionNo}</code></td>
                      <td style={{ padding: "8px 12px" }}>{r.title}</td>
                      <td style={{ padding: "8px 12px", textAlign: "end" }}>{r.vacancies}</td>
                      <td style={{ padding: "8px 12px" }}>
                        <StatusPill status={r.status} />
                        {stage && <span style={{ marginInlineStart: 8, color: "var(--mut)", fontSize: 12 }}>{t("waitingOn", { stage })}</span>}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {actionsFor(r.status).map((a) => (
                            <Button key={a} type="button" variant={a === "return" ? "ghost" : "primary"} size="sm" onClick={() => ask(r, a)}>{t(`action_${a}`)}</Button>
                          ))}
                          {opening && <Link href={`/hr/recruitment/${opening}`} className="btn ghost sm">{t("viewVacancy")}</Link>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={act.open}
        title={t(`confirmTitle_${kind}`, { no: pending?.no ?? "" })}
        description={t(`confirmBody_${kind}`)}
        confirmLabel={t(`action_${kind}`)}
        requireReason={kind === "return"}
        optionalReason={kind === "approve"}
        reasonLabel={t("commentsLabel")}
        maxReasonLength={2000}
        busy={act.busy}
        errorMessage={act.error}
        onConfirm={act.confirm}
        onCancel={act.cancel}
      />
    </div>
  );
}
