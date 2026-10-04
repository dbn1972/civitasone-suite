"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field, Input, Select, Textarea } from "../../../../_components/ds";
import { EmployeePicker } from "../../../../_components/EmployeePicker";
import { CodedRequestError, postWithErrorCode } from "../_lib/postWithErrorCode";
import {
  BULK_MAX_ROWS,
  MAX_REASON_LENGTH,
  MIN_REASON_LENGTH,
  buildAssignBody,
  buildBulkBody,
  buildEndBody,
  isIsoDate,
  parseBulkRejection,
  parseBulkResult,
  parseEmployeeCsv,
  rejectCodeKey,
  type BulkResult,
  type GroupOption,
} from "./payGroupMembership";

/**
 * Pay-group membership mutations (GAP-PAYROLL-PAY-GROUPS-03): assign, move,
 * end and bulk-assign. Every call is an effective-dated, audited write that
 * needs a reason (>= 10 chars, the server's own minimum) and carries an
 * idempotency key so a retried confirm cannot apply twice. 202 means accepted:
 * the page is refreshed and the member list catches up shortly after.
 */

const ERROR_CODES = [
  "EFFECTIVE_DATE_NOT_MONTH_START",
  "EMPLOYEE_NOT_FOUND",
  "PAY_GROUP_INACTIVE",
  "ALREADY_MEMBER",
  "MEMBERSHIP_OVERLAP",
  "NOT_A_MEMBER",
  "BULK_NOTHING_TO_ASSIGN",
] as const;

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function codeMessages(t: Translate): Record<string, string> {
  return Object.fromEntries(ERROR_CODES.map((c) => [c, t(`errors.${c}`)]));
}

function membersPath(groupId: string): string {
  return `v1/payroll/pay-groups/${groupId}/members`;
}

function ReasonDialog(props: {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  description?: ReactNode;
  busy: boolean;
  error: string | undefined;
  confirmDisabled: boolean;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("payGroupMembers");
  const { children, error, ...rest } = props;
  return (
    <ConfirmDialog
      {...rest}
      errorMessage={error}
      requireReason
      minReasonLength={MIN_REASON_LENGTH}
      maxReasonLength={MAX_REASON_LENGTH}
      reasonLabel={t("reasonLabel")}
    >
      <div style={{ display: "grid", gap: 12, marginBlock: 12 }}>{children}</div>
    </ConfirmDialog>
  );
}

function Notice({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="status" className="pill good" style={{ margin: 0, width: "fit-content" }}>
      {text}
    </p>
  );
}

/* ---------------------------------------------------------------- assign */

export function AssignEmployeeButton({ payGroupId, payGroupName, defaultDate }: { payGroupId: string; payGroupName: string; defaultDate: string }) {
  const t = useTranslations("payGroupMembers");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const keyRef = useRef("");

  function openDialog() {
    setEmployeeId(null);
    setDate(defaultDate);
    setError(undefined);
    setNotice(null);
    keyRef.current = newIdempotencyKey();
    setOpen(true);
  }

  async function submit(reason?: string) {
    if (!employeeId) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await postWithErrorCode<{ data?: { action?: string } }>(
        membersPath(payGroupId),
        buildAssignBody({ employeeId, effectiveFrom: date, reason: reason ?? "" }),
        codeMessages(t),
        { area: t("saveArea"), statusAware: true, idempotencyKey: keyRef.current },
      );
      setOpen(false);
      setNotice(res?.data?.action === "move" ? t("movedMessage") : t("assignedMessage"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <Button type="button" style={{ minHeight: 44 }} onClick={openDialog}>
        {t("assignBtn")}
      </Button>
      <Notice text={notice} />
      <ReasonDialog
        open={open}
        title={t("assignTitle", { group: payGroupName })}
        confirmLabel={t("assignConfirm")}
        busy={busy}
        error={error}
        confirmDisabled={!employeeId || !isIsoDate(date)}
        onConfirm={(r) => void submit(r)}
        onCancel={() => !busy && setOpen(false)}
      >
        <Field label={t("employeeLabel")} required>
          <EmployeePicker value={employeeId} onChange={(id) => setEmployeeId(id)} clearable />
        </Field>
        <Field label={t("effectiveDateLabel")} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("effectiveDateHint")}</p>
      </ReasonDialog>
    </div>
  );
}

/* ----------------------------------------------------------- move/assign */

/**
 * Move an employee to another pay group (`mode="move"`, from a members row)
 * or put an unassigned employee into one (`mode="assign"`). Both are the same
 * POST on the TARGET group; the server closes any current membership.
 */
export function ChangeGroupButton({
  mode, currentGroupId, employeeId, employeeName, groups, defaultDate,
}: {
  mode: "move" | "assign";
  currentGroupId?: string;
  employeeId: string;
  employeeName: string;
  groups: GroupOption[];
  defaultDate: string;
}) {
  const t = useTranslations("payGroupMembers");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const keyRef = useRef("");
  const targets = groups.filter((g) => g.id !== currentGroupId);

  function openDialog() {
    setTarget("");
    setDate(defaultDate);
    setError(undefined);
    setNotice(null);
    keyRef.current = newIdempotencyKey();
    setOpen(true);
  }

  async function submit(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await postWithErrorCode(
        membersPath(target),
        buildAssignBody({ employeeId, effectiveFrom: date, reason: reason ?? "" }),
        codeMessages(t),
        { area: t("saveArea"), statusAware: true, idempotencyKey: keyRef.current },
      );
      setOpen(false);
      setNotice(mode === "move" ? t("movedMessage") : t("assignedMessage"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Button type="button" size="sm" variant="secondary" onClick={openDialog} aria-label={t(mode === "move" ? "moveAria" : "assignToGroupAria", { name: employeeName })}>
        {t(mode === "move" ? "moveBtn" : "assignToGroupBtn")}
      </Button>
      <Notice text={notice} />
      <ReasonDialog
        open={open}
        title={t(mode === "move" ? "moveTitle" : "assignToGroupTitle", { name: employeeName })}
        confirmLabel={t(mode === "move" ? "moveConfirm" : "assignConfirm")}
        busy={busy}
        error={error}
        confirmDisabled={!target || !isIsoDate(date)}
        onConfirm={(r) => void submit(r)}
        onCancel={() => !busy && setOpen(false)}
      >
        <Field label={t("targetLabel")} required>
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t("targetPlaceholder")}</option>
            {targets.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("effectiveDateLabel")} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("effectiveDateHint")}</p>
      </ReasonDialog>
    </span>
  );
}

/* ------------------------------------------------------------------- end */

export function EndMembershipButton({
  payGroupId, employeeId, employeeName, defaultDate,
}: {
  payGroupId: string;
  employeeId: string;
  employeeName: string;
  defaultDate: string;
}) {
  const t = useTranslations("payGroupMembers");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const keyRef = useRef("");

  function openDialog() {
    setDate(defaultDate);
    setError(undefined);
    setNotice(null);
    keyRef.current = newIdempotencyKey();
    setOpen(true);
  }

  async function submit(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await postWithErrorCode(
        `${membersPath(payGroupId)}/${employeeId}/end`,
        buildEndBody({ endsOn: date, reason: reason ?? "" }),
        codeMessages(t),
        { area: t("saveArea"), statusAware: true, idempotencyKey: keyRef.current },
      );
      setOpen(false);
      setNotice(t("endedMessage"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Button type="button" size="sm" variant="ghost" onClick={openDialog} aria-label={t("endAria", { name: employeeName })}>
        {t("endBtn")}
      </Button>
      <Notice text={notice} />
      <ReasonDialog
        open={open}
        danger
        title={t("endTitle", { name: employeeName })}
        confirmLabel={t("endConfirm")}
        busy={busy}
        error={error}
        confirmDisabled={!isIsoDate(date)}
        onConfirm={(r) => void submit(r)}
        onCancel={() => !busy && setOpen(false)}
      >
        <Field label={t("endDateLabel")} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("endDateHint")}</p>
      </ReasonDialog>
    </span>
  );
}

/* ------------------------------------------------------------------ bulk */

function BulkResultPanel({ result }: { result: BulkResult }) {
  const t = useTranslations("payGroupMembers");
  return (
    <section role="status" aria-label={t("bulkResultTitle")} style={{ display: "grid", gap: 8, width: "100%" }}>
      <h4 style={{ margin: 0 }}>{t("bulkResultTitle")}</h4>
      {result.accepted > 0 ? (
        <p className="pill good" style={{ margin: 0, width: "fit-content" }}>{t("bulkAccepted", { count: result.accepted })}</p>
      ) : (
        <p className="pill warn" style={{ margin: 0, width: "fit-content" }}>{t("bulkNothing")}</p>
      )}
      {result.rejected.length > 0 && (
        <>
          <p className="pill bad" style={{ margin: 0, width: "fit-content" }}>{t("bulkRejected", { count: result.rejected.length })}</p>
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("colRow")}</th>
                <th scope="col">{t("colEmployeeNo")}</th>
                <th scope="col">{t("colRejectReason")}</th>
              </tr>
            </thead>
            <tbody>
              {result.rejected.map((r) => (
                <tr key={`${r.row}-${r.employeeNo ?? ""}`}>
                  <td>{r.row + 1}</td>
                  <td>{r.employeeNo ?? "—"}</td>
                  <td>{t(`rejectCode.${rejectCodeKey(r.code)}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function BulkAssignButton({
  groups, fixedGroupId, initialEmployeeNos, defaultDate,
}: {
  groups: GroupOption[];
  /** When set, the dialog assigns into this group and shows no group picker. */
  fixedGroupId?: string;
  /** Pre-filled list (e.g. the unassigned report's rows). */
  initialEmployeeNos?: string[];
  defaultDate: string;
}) {
  const t = useTranslations("payGroupMembers");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(fixedGroupId ?? "");
  const [text, setText] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<BulkResult | null>(null);
  const keyRef = useRef("");
  const parsed = parseEmployeeCsv(text);
  const noRows = parsed.employeeNos.length < 1;

  function openDialog() {
    setGroup(fixedGroupId ?? "");
    setText((initialEmployeeNos ?? []).join("\n"));
    setDate(defaultDate);
    setError(undefined);
    setResult(null);
    keyRef.current = newIdempotencyKey();
    setOpen(true);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      setText(await file.text());
    } catch {
      setError(t("fileReadError"));
    }
  }

  async function submit(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await postWithErrorCode(
        `${membersPath(group)}/bulk`,
        buildBulkBody({ effectiveFrom: date, reason: reason ?? "", employeeNos: parsed.employeeNos }),
        codeMessages(t),
        { area: t("saveArea"), statusAware: true, idempotencyKey: keyRef.current },
      );
      setOpen(false);
      setResult(parseBulkResult(res));
      router.refresh();
    } catch (err) {
      if (err instanceof CodedRequestError && err.code === "BULK_NOTHING_TO_ASSIGN") {
        // Every row was rejected: show the per-row reasons, not just one line.
        setOpen(false);
        setResult(parseBulkRejection(err.details));
        return;
      }
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <Button type="button" variant="secondary" style={{ minHeight: 44 }} onClick={openDialog}>
          {t("bulkBtn")}
        </Button>
      </div>
      {result && <BulkResultPanel result={result} />}
      <ReasonDialog
        open={open}
        title={t("bulkTitle")}
        confirmLabel={t("bulkConfirm")}
        busy={busy}
        error={error}
        confirmDisabled={noRows || parsed.exceedsLimit || !group || !isIsoDate(date)}
        onConfirm={(r) => void submit(r)}
        onCancel={() => !busy && setOpen(false)}
      >
        {!fixedGroupId && (
          <Field label={t("targetLabel")} required>
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">{t("targetPlaceholder")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("bulkFileLabel")}>
          <Input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
        </Field>
        <Field label={t("bulkPasteLabel")} required>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
          {noRows ? t("bulkNoRows") : t("bulkParsed", { count: parsed.employeeNos.length })}
          {parsed.duplicateCount > 0 ? ` ${t("bulkDuplicates", { count: parsed.duplicateCount })}` : ""}
          {parsed.exceedsLimit ? ` ${t("bulkTooMany", { max: BULK_MAX_ROWS })}` : ""}
        </p>
        <Field label={t("effectiveDateLabel")} required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("effectiveDateHint")}</p>
      </ReasonDialog>
    </div>
  );
}
