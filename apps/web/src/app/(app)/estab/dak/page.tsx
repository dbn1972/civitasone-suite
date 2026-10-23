"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Button, PageHeader, StatusPill, DataTable, EmptyState, ErrorState, EntityPicker,
  ConfirmDialog, // GAP-ESTAB-DAK-01: confirmation before opening file
} from "../../../_components/ds";
import { formatIndianDate, humanizeStatus, todayIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import { ESTAB_FILES_WRITE_ROLES } from "@/lib/estab/roles";
import { useEstabT } from "@/lib/estab/useEstabT";
import { useEstabDivisions } from "@/lib/estab/useEstabDivisions";
import { deptFieldMode } from "@/lib/estab/deptField";
import { usePagedRegister } from "@/lib/estab/usePagedRegister";
import { startBoundedPoll } from "@/lib/estab/boundedPoll";
import { DAK_MODES, EMPTY_DAK_FORM, dakLookupTerm, validateDakForm, type DakFormState } from "@/lib/estab/dakForm";

// GAP-ESTAB-DAK-01: classification is no longer hard-coded; the clerk chooses.
const CLASSIFICATIONS = ["public", "confidential", "secret", "top_secret"] as const;
const CLASS_KEY = Object.fromEntries([
  ["public", "classPublic"],
  ["confidential", "classConfidential"],
  ["secret", "classSecret"],
  ["top_secret", "classTopSecret"],
]) as Record<(typeof CLASSIFICATIONS)[number], string>;

/** Rows fetched per request; the register is paged and searched on the server (GAP-ESTAB-DAK-04). */
const PAGE_SIZE = 50;

type InwardRow = {
  id: string;
  dakNo: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  status: string;
  fileId?: string | null;
  fileRef?: string | null;
  barcode?: string | null;
  sourceSection?: string | null;
};

type OpenFileForm = {
  inwardId: string;
  dakNo: string;
  subject: string;
  dept: string;
  classification: string;
};

export default function DakRegistryPage() {
  const t = useEstabT();
  const router = useRouter();
  const formError = useFormError("DAK register");
  const identity = useSessionIdentity();
  // The register/open-file routes are estab-officer only; an audit officer reads the register
  // without dead write controls. The service stays the authority.
  const canWrite = identity.roles.some((r) => ESTAB_FILES_WRITE_ROLES.includes(r));
  const depts = useEstabDivisions();
  const deptMode = deptFieldMode(depts);

  const reg = usePagedRegister<InwardRow>("/api/proxy/v1/estab/inward", PAGE_SIZE);
  const { rows, total, loading, failed: loadError, hasMore } = reg;
  const [form, setForm] = useState<DakFormState>({ ...EMPTY_DAK_FORM });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  // GAP-ESTAB-DAK-01: open-file dialog state
  const [openFileDialog, setOpenFileDialog] = useState<OpenFileForm | null>(null);
  const [openFileBusy, setOpenFileBusy] = useState(false);
  const [openFileError, setOpenFileError] = useState("");

  // GAP-ESTAB-DAK-03: polls that look up the number and barcode of an accepted registration; cancelled on unmount.
  const cancels = useRef<Array<() => void>>([]);
  const mounted = useRef(true);
  // The latest reload (it follows the current search term), for callbacks that outlive a render.
  const reloadRef = useRef(reg.reload);
  reloadRef.current = reg.reload;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancels.current.forEach((cancel) => cancel());
      cancels.current = [];
    };
  }, []);

  /**
   * GAP-ESTAB-DAK-03: the 202 carries only the row id, because the DAK number and barcode are
   * allocated when the service processes the registration. Look the row up by that id a bounded
   * number of times, and put the number and barcode in the message once it is there. `term` is
   * what the register search finds the row by (dakLookupTerm: the typed number, else the start of
   * the subject, cut to the 100 characters the search accepts), whatever its received date.
   */
  function watchRegistration(rowId: string, term: string) {
    const cancel = startBoundedPoll<InwardRow>({
      check: async () => {
        const res = await fetch(`/api/proxy/v1/estab/inward?limit=${PAGE_SIZE}&q=${encodeURIComponent(term)}`);
        if (!res.ok) return null;
        const body = (await res.json()) as { data?: InwardRow[] };
        return (body.data ?? []).find((r) => r.id === rowId) ?? null;
      },
      onResolved: (row) => {
        if (!mounted.current) return;
        setMessage(t("dakRegisteredWithBarcode", { dakNo: row.dakNo, barcode: row.barcode ?? "—" }));
        void reloadRef.current();
      },
      onExhausted: () => { /* the message already says the number appears in the register once processed */ },
    });
    cancels.current.push(cancel);
  }

  // A failed "Load more" keeps the rows on screen and says so.
  useEffect(() => {
    if (reg.moreError) setActionError(formError.fromException("load", reg.moreError).message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg.moreError]);

  // GAP-ESTAB-DAK-02: clerk-safe error on registerDak. GAP-ESTAB-DAK-03: validated payload.
  async function registerDak(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setActionError("");
    const checked = validateDakForm(form, todayIST());
    if (!checked.ok) {
      const translated = Object.fromEntries(Object.entries(checked.errors).map(([k, v]) => [k, t(v)]));
      setFieldErrors(translated);
      setActionError(Object.values(translated)[0] ?? "");
      return;
    }
    setFieldErrors({});
    try {
      const res = await fetch("/api/proxy/v1/estab/inward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checked.payload),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      // The register is written asynchronously (202), so the DAK number and barcode the service
      // assigns are not in the response. Say what is known now, then replace it with the
      // allocated number and barcode as soon as the row exists (watchRegistration).
      let rowId: string | null = null;
      try {
        const accepted = (await res.json()) as { id?: unknown };
        if (typeof accepted.id === "string") rowId = accepted.id;
      } catch {
        /* the body is optional */
      }
      setForm({ ...EMPTY_DAK_FORM });
      setMessage(form.dakNo.trim() ? t("dakRegisteredNo", { dakNo: form.dakNo.trim() }) : t("dakRegisteredAuto"));
      await reg.reload();
      const term = dakLookupTerm(checked.payload);
      if (rowId && term) watchRegistration(rowId, term);
    } catch (err) {
      setActionError(formError.fromException("save", err).message);
    }
  }

  // GAP-ESTAB-DAK-01: open-file dialog initiation.
  function promptOpenFile(row: InwardRow) {
    setOpenFileDialog({
      inwardId: row.id,
      dakNo: row.dakNo,
      subject: row.subject,
      dept: "",
      classification: "", // force a choice — never default to "public"
    });
    setOpenFileError("");
  }

  // GAP-ESTAB-DAK-01 + DAK-02: confirmed open-file with chosen classification.
  async function confirmOpenFile() {
    if (!openFileDialog) return;
    if (!openFileDialog.dept) { setOpenFileError(t("errDeptRequired")); return; }
    if (!openFileDialog.classification) { setOpenFileError(t("errClassRequired")); return; }
    setOpenFileBusy(true);
    setOpenFileError("");
    try {
      const res = await fetch(`/api/proxy/v1/estab/inward/${openFileDialog.inwardId}/open-file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dept: openFileDialog.dept,
          classification: openFileDialog.classification,
        }),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      const body = await res.json() as { id?: string };
      setOpenFileDialog(null);
      // ?created=1 makes the file page show the number the service allocated once it is processed.
      if (body.id) router.push(`/estab/files/${encodeURIComponent(body.id)}?created=1`);
      else {
        setMessage(t("fileOpeningRefresh"));
        await reg.reload();
      }
    } catch (e) {
      setOpenFileError(formError.fromException("save", e).message);
    } finally {
      setOpenFileBusy(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: 8, borderRadius: 8,
    border: "1px solid var(--line)", minHeight: 44,
  } as const;
  const dismissStyle = { marginInlineStart: 12, border: "none", background: "transparent", cursor: "pointer", fontSize: 12 } as const;
  const fieldProps = { className: "fld", style: { flexDirection: "column", alignItems: "flex-start" } } as const;

  return (
    <>
      <PageHeader title={t("dakTitle")} subtitle={t("dakSubtitle")} back="/estab" />

      {/* GAP-ESTAB-DAK-06: DS tokens instead of hex literals */}
      <div role="status" aria-live="polite">
        {message ? (
          <div className="alert good" style={{ borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 13 }}>
            {message}
            <button type="button" style={dismissStyle} onClick={() => setMessage("")}>{t("dismiss")}</button>
          </div>
        ) : null}
      </div>
      <div role="alert" aria-live="assertive">
        {actionError ? (
          <div className="alert bad" style={{ borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 13 }}>
            {actionError}
            <button type="button" style={dismissStyle} onClick={() => setActionError("")}>{t("dismiss")}</button>
          </div>
        ) : null}
      </div>

      {canWrite ? (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-h"><h3>{t("dakRegisterHeading")}</h3></div>
          <form onSubmit={registerDak} className="pad" noValidate>
            <div className="fields">
              <div {...fieldProps}>
                <label className="l" htmlFor="dak-no">{t("dakNoLabel")} <span style={{ color: "var(--mut)", fontWeight: 400 }}>{t("dakNoAutoHint")}</span></label>
                <input id="dak-no" value={form.dakNo} onChange={(e) => setForm({ ...form, dakNo: e.target.value })} style={inputStyle} />
              </div>
              <div {...fieldProps}>
                <label className="l" htmlFor="dak-from">{t("dakFrom")}</label>
                <input id="dak-from" required aria-invalid={Boolean(fieldErrors.fromAddress)} value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} style={inputStyle} />
              </div>
              <div {...fieldProps}>
                <label className="l" htmlFor="dak-subject">{t("dakSubject")}</label>
                <input id="dak-subject" required aria-invalid={Boolean(fieldErrors.subject)} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} style={inputStyle} />
              </div>
              {/* GAP-ESTAB-DAK-03: additional fields matching registerInwardBody */}
              <div {...fieldProps}>
                <label className="l" htmlFor="dak-mode">{t("dakMode")}</label>
                <select id="dak-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} style={inputStyle}>
                  <option value="">{t("dakModeUnspecified")}</option>
                  {DAK_MODES.map((m) => <option key={m} value={m}>{humanizeStatus(m)}</option>)}
                </select>
              </div>
              <div {...fieldProps}>
                <label className="l" htmlFor="dak-received">{t("dakReceivedDate")}</label>
                <input id="dak-received" type="date" max={todayIST()} aria-invalid={Boolean(fieldErrors.receivedDate)} value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} style={inputStyle} />
              </div>
              <div {...fieldProps}>
                <label className="l" htmlFor="dak-urgency">{t("dakUrgency")}</label>
                <select id="dak-urgency" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} style={inputStyle}>
                  <option value="">{t("dakUrgNormal")}</option>
                  <option value="urgent">{t("dakUrgUrgent")}</option>
                  <option value="immediate">{t("dakUrgImmediate")}</option>
                </select>
              </div>
              <div {...fieldProps}>
                <span className="l" id="dak-addressee-l">{t("dakAddressee")}</span>
                {/* Addressee officer: a searchable picker, returns a real hrms employee id. */}
                <EntityPicker
                  value={form.assignedTo}
                  onChange={(v) => setForm({ ...form, assignedTo: Array.isArray(v) ? (v[0] ?? null) : v })}
                  search={searchEmployees}
                  resolve={resolveEmployees}
                  placeholder={t("dakAddresseePlaceholder")}
                  aria-label={t("dakAddressee")}
                />
              </div>
              <div {...fieldProps}>
                <label className="l" htmlFor="dak-source-section">{t("dakSourceSection")}</label>
                <input id="dak-source-section" value={form.sourceSection} onChange={(e) => setForm({ ...form, sourceSection: e.target.value })} style={inputStyle} />
              </div>
            </div>
            <Button type="submit" style={{ marginTop: 12 }}>{t("dakRegisterBtn")}</Button>
          </form>
        </div>
      ) : null}

      <div className="card">
        <div className="card-h">
          <h3>{t("dakRegisterListHeading")}</h3>
          {/* GAP-ESTAB-DAK-04: how much of the register is on screen. */}
          {!loading && !loadError && total > 0 && (
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{t("showingOf", { shown: rows.length, total })}</span>
          )}
        </div>
        <div className="pad" style={{ paddingBottom: 0 }}>
          {/* GAP-ESTAB-DAK-04: search runs on the server, over the whole register. */}
          <label className="l" htmlFor="dak-search">{t("dakSearchLabel")}</label>
          <input
            id="dak-search"
            type="search"
            value={reg.searchInput}
            onChange={(e) => reg.setSearchInput(e.target.value)}
            placeholder={t("dakSearchPlaceholder")}
            style={inputStyle}
          />
        </div>
        {loading ? (
          <p className="pad" style={{ textAlign: "center", color: "var(--mut)" }}>{t("loading")}</p>
        ) : loadError ? (
          <div className="pad"><ErrorState error={toHumanError("load", { area: "inward register" })} onRetry={() => void reg.reload()} /></div>
        ) : rows.length === 0 && reg.query ? (
          <EmptyState icon="🔎" title={t("dakNoMatchTitle")} message={t("dakNoMatchMessage")} />
        ) : rows.length === 0 ? (
          <EmptyState icon="📥" title={t("dakEmptyTitle")} message={t("dakEmptyMessage")} />
        ) : (
          <>
            <DataTable<InwardRow>
              columns={[
                { key: "dakNo", label: t("colDakNo"), render: (r) => <span className="mono">{r.dakNo}</span> },
                { key: "barcode", label: t("colBarcode"), render: (r) => <span className="mono" style={{ fontSize: 11 }}>{r.barcode ?? "—"}</span> },
                {
                  key: "sourceSection", label: t("colSource"),
                  // GAP-ESTAB-DAK-05: "—" for null, not the invented literal "manual".
                  render: (r) => <>{r.sourceSection ? humanizeStatus(r.sourceSection) : "—"}</>,
                },
                { key: "fromAddress", label: t("dakFrom") },
                { key: "subject", label: t("dakSubject") },
                { key: "receivedAt", label: t("colReceived"), render: (r) => <>{formatIndianDate(r.receivedAt)}</> },
                {
                  key: "status", label: t("colStatus"),
                  // GAP-ESTAB-DAK-05: drop the label prop so StatusPill humanises internally.
                  render: (r) => <StatusPill status={r.status} />,
                },
                {
                  key: "fileId",
                  label: t("colFile"),
                  // The file number, never an id fragment: a file with no number yet reads "View file".
                  render: (r) =>
                    r.fileId ? (
                      <Link href={`/estab/files/${r.fileId}`} className="mono">{r.fileRef ?? t("viewFile")}</Link>
                    ) : (
                      <>—</>
                    ),
                },
                ...(canWrite ? [{
                  key: "id" as const,
                  label: t("colAction"),
                  sortable: false,
                  // GAP-ESTAB-DAK-01: opens a dialog instead of direct POST.
                  render: (r: InwardRow) =>
                    !r.fileId && r.status === "received" ? (
                      <Button type="button" variant="ghost" onClick={() => promptOpenFile(r)}>
                        {t("openFile")}
                      </Button>
                    ) : (
                      <>—</>
                    ),
                }] : []),
              ]}
              rows={rows}
              sortable
              pageSize={15}
            />
            {hasMore ? (
              <div className="pad" style={{ textAlign: "center" }}>
                <Button type="button" variant="ghost" disabled={reg.loadingMore} onClick={() => void reg.loadMore()}>
                  {reg.loadingMore ? t("loading") : t("loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* GAP-ESTAB-DAK-01: open-file confirmation dialog with classification + dept. */}
      {openFileDialog && (
        <ConfirmDialog
          open
          title={t("openFileTitle", { dakNo: openFileDialog.dakNo })}
          description={t("openFileDesc", { subject: openFileDialog.subject })}
          confirmLabel={openFileBusy ? t("opening") : t("confirmOpenFile")}
          onConfirm={confirmOpenFile}
          onCancel={() => setOpenFileDialog(null)}
        >
          <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>{t("dept")} <span style={{ color: "var(--bad)" }}>*</span></span>
              {/* GAP-ESTAB-FILES-NEW-03: a pick-list of real departments, never free text. */}
              {deptMode === "typed" ? (
                /* No department master exists to pick from (no operators enrolled yet, or this role cannot read the
                   directory), so there is nothing to validate a typed name against: type it. */
                <input
                  type="text"
                  value={openFileDialog.dept}
                  onChange={(e) => setOpenFileDialog({ ...openFileDialog, dept: e.target.value })}
                  required
                  maxLength={100}
                />
              ) : (
                <select
                  value={openFileDialog.dept}
                  onChange={(e) => setOpenFileDialog({ ...openFileDialog, dept: e.target.value })}
                  required
                  disabled={deptMode !== "pick"}
                >
                  <option value="">{t("deptSelect")}</option>
                  {depts.divisions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              {deptMode === "typed" ? (
                <span role="note" style={{ color: "var(--mut)", fontSize: 12 }}>{t("deptNone")}</span>
              ) : null}
              {deptMode === "blocked" ? (
                <span role="alert" style={{ color: "var(--bad)", fontSize: 12 }}>{t("deptLoadFailed")}</span>
              ) : null}
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.8125rem" }}>
              <span>{t("classification")} <span style={{ color: "var(--bad)" }}>*</span></span>
              <select
                value={openFileDialog.classification}
                onChange={(e) => setOpenFileDialog({ ...openFileDialog, classification: e.target.value })}
                required
              >
                <option value="">{t("classSelect")}</option>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>{t(CLASS_KEY[c])}</option>
                ))}
              </select>
            </label>
            {openFileError && <p role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{openFileError}</p>}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
