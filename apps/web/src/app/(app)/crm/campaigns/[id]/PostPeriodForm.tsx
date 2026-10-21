"use client";
/**
 * GAP-CRM-CAMPAIGNS-DETAIL-04: a way to post a reporting period's cost, revenue
 * and responses from the campaign detail page, so the empty state's "Post a
 * reporting period's cost and revenue" is no longer a dead-end instruction.
 *
 * The write is admin-gated server-side (PUT /v1/crm/campaigns/:id/performance);
 * a non-admin gets a 403 which is surfaced via the shared error copy. Money is
 * entered in rupees and converted to paise strings by postCampaignPeriod.
 */
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { Button, Card, Field, Input } from "../../../../_components/ds";
import {
  postCampaignPeriod,
  CampaignPeriodValidationError,
  MAX_CAMPAIGN_NAME_LENGTH,
} from "@/lib/crm/campaignPeriods";

/** Server cap on the responses count (PUT /v1/crm/campaigns/:id/performance). */
const MAX_RESPONSES = 100_000_000;

export function PostPeriodForm({
  campaignId,
  currency,
  campaignName: currentName = "",
}: {
  campaignId: string;
  currency: string;
  /** The campaign's current name (if it has one), pre-filled so a post keeps it. */
  campaignName?: string;
}) {
  const t = useTranslations("crm.postPeriod");
  const formError = useFormError("campaign period");
  const router = useRouter();
  const [campaignName, setCampaignName] = useState(currentName);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [costRupees, setCostRupees] = useState("");
  const [revenueRupees, setRevenueRupees] = useState("");
  const [responses, setResponses] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await postCampaignPeriod(campaignId, {
        periodStart,
        periodEnd: periodEnd || undefined,
        costRupees,
        revenueRupees,
        responses: Number(responses),
        currency,
        campaignName,
      });
      setMessage(t("submitted"));
      setPeriodStart("");
      setPeriodEnd("");
      setCostRupees("");
      setRevenueRupees("");
      setResponses("0");
      router.refresh();
    } catch (err) {
      if (err instanceof CampaignPeriodValidationError) {
        setError(err.message);
      } else {
        setError(formError.fromException("save", err).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("title")}>
      <form className="pad" style={{ display: "grid", gap: 12 }} onSubmit={(e) => void onSubmit(e)} aria-label={t("title")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Field label={t("campaignName")}>
            <Input
              value={campaignName}
              maxLength={MAX_CAMPAIGN_NAME_LENGTH}
              placeholder={t("campaignNamePlaceholder")}
              onChange={(e) => setCampaignName(e.target.value)}
            />
          </Field>
          <Field label={t("periodStart")} required>
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </Field>
          <Field label={t("periodEnd")}>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
          <Field label={t("spend", { currency })}>
            <Input inputMode="decimal" placeholder="0.00" value={costRupees} onChange={(e) => setCostRupees(e.target.value)} />
          </Field>
          <Field label={t("revenue", { currency })}>
            <Input inputMode="decimal" placeholder="0.00" value={revenueRupees} onChange={(e) => setRevenueRupees(e.target.value)} />
          </Field>
          <Field label={t("responses")}>
            <Input type="number" min={0} max={MAX_RESPONSES} step={1} value={responses} onChange={(e) => setResponses(e.target.value)} />
          </Field>
        </div>
        {error ? (
          <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: 0 }}>{error}</p>
        ) : null}
        {message ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", margin: 0 }}>{message}</p>
        ) : null}
        <div>
          <Button type="submit" disabled={busy}>{busy ? t("posting") : t("post")}</Button>
        </div>
      </form>
    </Card>
  );
}
