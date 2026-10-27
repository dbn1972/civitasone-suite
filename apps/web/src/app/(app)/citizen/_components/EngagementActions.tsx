"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { UserFacingError } from "@/lib/userFacingError";

/**
 * GAP-CITIZEN-ALERTS-05 / GAP-CITIZEN-NOTICES-05: officer authoring controls for
 * the public alerts and notice board. The service enforces the real rules
 * (officer-tier roles, maker-checker: nobody publishes their own draft, past
 * expiry rejected); the web only shows the controls to officer roles and
 * surfaces the service's refusal in plain language. Every call is a CQRS
 * command (202), so the list is refreshed after the call.
 */

const inputStyle = { width: "100%", padding: 8, minHeight: 44, marginBottom: 8, borderRadius: 8, border: "1px solid var(--line)" } as const;
const labelStyle = { display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4, fontWeight: 600 } as const;

export type EngagementKind = "alerts" | "notices";

function useEngagementPost() {
  const router = useRouter();
  const formError = useFormError("announcement");
  async function post(path: string, body?: unknown): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`/api/proxy/v1/citizen/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
    } catch (caught) {
      throw UserFacingError.from(formError.fromException("save", caught));
    }
    if (!res.ok) throw UserFacingError.from(await formError.fromResponse(res, "save"));
  }
  return { post, refresh: () => router.refresh() };
}

/** `<input type="datetime-local">` value -> ISO instant, or undefined when blank/invalid. */
function toIsoOrUndefined(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function NewAlertButton() {
  const t = useTranslations("citizenEngagementActions");
  const { post, refresh } = useEngagementPost();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [audience, setAudience] = useState("");
  const [expires, setExpires] = useState("");
  return (
    <ActionButton
      label={t("newAlert")}
      confirmTitle={t("newAlertTitle")}
      confirmDescription={t("draftNote")}
      confirmLabel={t("saveDraft")}
      blockConfirm={title.trim().length === 0}
      onConfirm={async () => {
        await post("alerts", {
          title: title.trim(),
          ...(body.trim() ? { body: body.trim() } : {}),
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(audience.trim() ? { targetAudience: audience.trim() } : {}),
          ...(toIsoOrUndefined(expires) ? { expiresAt: toIsoOrUndefined(expires) } : {}),
        });
      }}
      onSuccess={() => { setTitle(""); setBody(""); setCategory(""); setAudience(""); setExpires(""); refresh(); }}
    >
      <label htmlFor="alert-title" style={labelStyle}>{t("fieldTitle")}</label>
      <input id="alert-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
      <label htmlFor="alert-body" style={labelStyle}>{t("fieldBody")}</label>
      <textarea id="alert-body" value={body} maxLength={4000} rows={4} onChange={(e) => setBody(e.target.value)} style={{ ...inputStyle, minHeight: 88 }} />
      <label htmlFor="alert-category" style={labelStyle}>{t("fieldCategory")}</label>
      <input id="alert-category" value={category} maxLength={64} onChange={(e) => setCategory(e.target.value)} style={inputStyle} />
      <label htmlFor="alert-audience" style={labelStyle}>{t("fieldAudience")}</label>
      <input id="alert-audience" value={audience} maxLength={128} onChange={(e) => setAudience(e.target.value)} style={inputStyle} />
      <label htmlFor="alert-expires" style={labelStyle}>{t("fieldExpires")}</label>
      <input id="alert-expires" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} style={inputStyle} />
    </ActionButton>
  );
}

const NOTICE_TYPES = ["general", "statutory", "public_hearing", "tender"] as const;

export function NewNoticeButton() {
  const t = useTranslations("citizenEngagementActions");
  const { post, refresh } = useEngagementPost();
  const [subject, setSubject] = useState("");
  const [department, setDepartment] = useState("");
  const [noticeNo, setNoticeNo] = useState("");
  const [type, setType] = useState<(typeof NOTICE_TYPES)[number]>("general");
  const [body, setBody] = useState("");
  const [expires, setExpires] = useState("");
  return (
    <ActionButton
      label={t("newNotice")}
      confirmTitle={t("newNoticeTitle")}
      confirmDescription={t("draftNote")}
      confirmLabel={t("saveDraft")}
      blockConfirm={subject.trim().length === 0 || department.trim().length === 0}
      onConfirm={async () => {
        await post("notices", {
          subject: subject.trim(),
          department: department.trim(),
          type,
          ...(noticeNo.trim() ? { noticeNo: noticeNo.trim() } : {}),
          ...(body.trim() ? { body: body.trim() } : {}),
          ...(toIsoOrUndefined(expires) ? { expiresAt: toIsoOrUndefined(expires) } : {}),
        });
      }}
      onSuccess={() => { setSubject(""); setDepartment(""); setNoticeNo(""); setType("general"); setBody(""); setExpires(""); refresh(); }}
    >
      <label htmlFor="notice-subject" style={labelStyle}>{t("fieldSubject")}</label>
      <input id="notice-subject" value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
      <label htmlFor="notice-department" style={labelStyle}>{t("fieldDepartment")}</label>
      <input id="notice-department" value={department} maxLength={128} onChange={(e) => setDepartment(e.target.value)} style={inputStyle} />
      <label htmlFor="notice-no" style={labelStyle}>{t("fieldNoticeNo")}</label>
      <input id="notice-no" value={noticeNo} maxLength={64} onChange={(e) => setNoticeNo(e.target.value)} style={inputStyle} />
      <label htmlFor="notice-type" style={labelStyle}>{t("fieldType")}</label>
      <select id="notice-type" value={type} onChange={(e) => setType(e.target.value as (typeof NOTICE_TYPES)[number])} style={inputStyle}>
        {NOTICE_TYPES.map((v) => <option key={v} value={v}>{t(`type_${v}`)}</option>)}
      </select>
      <label htmlFor="notice-body" style={labelStyle}>{t("fieldBody")}</label>
      <textarea id="notice-body" value={body} maxLength={8000} rows={4} onChange={(e) => setBody(e.target.value)} style={{ ...inputStyle, minHeight: 88 }} />
      <label htmlFor="notice-expires" style={labelStyle}>{t("fieldExpires")}</label>
      <input id="notice-expires" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} style={inputStyle} />
    </ActionButton>
  );
}

/**
 * Publish (draft only) and Withdraw (any not-yet-withdrawn row) for one alert or
 * notice. Publishing a public notice is a statutory act, so each action goes
 * through a confirmation dialog; the service audits it and enforces maker-checker.
 */
export function PublishWithdrawActions({ kind, id, status }: { kind: EngagementKind; id: string; status: string }) {
  const t = useTranslations("citizenEngagementActions");
  const { post, refresh } = useEngagementPost();
  const noun = kind === "alerts" ? t("nounAlert") : t("nounNotice");
  const isDraft = status === "draft";
  const isWithdrawn = status === "withdrawn";
  if (!isDraft && isWithdrawn) return null;
  return (
    <span style={{ display: "inline-flex", gap: 8 }}>
      {isDraft ? (
        <ActionButton
          label={t("publish")}
          className="btn primary sm"
          confirmTitle={t("publishTitle", { noun })}
          confirmDescription={t("publishDescription", { noun })}
          confirmLabel={t("publish")}
          onConfirm={() => post(`${kind}/${id}/publish`)}
          onSuccess={refresh}
        />
      ) : null}
      {!isWithdrawn ? (
        <ActionButton
          label={t("withdraw")}
          className="btn danger sm"
          danger
          confirmTitle={t("withdrawTitle", { noun })}
          confirmDescription={t("withdrawDescription", { noun })}
          confirmLabel={t("withdraw")}
          onConfirm={() => post(`${kind}/${id}/withdraw`)}
          onSuccess={refresh}
        />
      ) : null}
    </span>
  );
}
