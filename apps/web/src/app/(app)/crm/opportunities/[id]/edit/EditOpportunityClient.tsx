"use client";
/**
 * EditOpportunityClient — OP-003 edit mode (GAP-CRM-OPPORTUNITIES-06).
 *
 * The opportunities segment previously had only a `new/` route, so
 * OpportunityForm's edit mode (its `opportunity` prop) was unreachable — a board
 * or list card name could not be opened. This client loads the single
 * opportunity over GET /v1/crm/deals/:id (getOpportunity) and renders
 * OpportunityForm pre-filled; the form PATCHes via updateOpportunity, so the
 * server's stage-move gate still governs any stage/value change.
 *
 * A failed load shows a retriable error (never a blank edit form that would
 * PATCH over the record with empty values).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@/app/_components/ds";
import { OpportunityForm } from "@/app/_components/crm/OpportunityForm";
import { getOpportunity, type Opportunity } from "@/lib/crm/opportunity";

export function EditOpportunityClient({ id }: { id: string }) {
  const t = useTranslations("crm.editOpportunity");
  const router = useRouter();
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "missing">("loading");

  async function load(isLive: () => boolean = () => true) {
    setState("loading");
    const { data, source } = await getOpportunity(id);
    if (!isLive()) return;
    if (source === "error") {
      setState("error");
      return;
    }
    if (!data) {
      setState("missing");
      return;
    }
    setOpportunity(data);
    setState("ready");
  }

  useEffect(() => {
    let live = true;
    void load(() => live);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is redefined each render but only closes over `id` (listed) and stable setters.
  }, [id]);

  if (state === "loading") {
    return (
      <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)" }}>
        {t("loading")}
      </p>
    );
  }
  if (state === "error") {
    return (
      <EmptyState
        icon="⚠️"
        title={t("loadFailedTitle")}
        message={t("loadFailedMessage")}
        action={
          <Button type="button" onClick={() => void load()}>
            {t("retry")}
          </Button>
        }
      />
    );
  }
  if (state === "missing" || !opportunity) {
    return (
      <EmptyState
        icon="🗂️"
        title={t("notFoundTitle")}
        message={t("notFoundMessage")}
        action={<a className="btn" href="/crm/opportunities">{t("back")}</a>}
      />
    );
  }

  return (
    <OpportunityForm
      opportunity={opportunity}
      onSaved={(savedId) => {
        router.push(savedId ? `/crm/opportunities?updated=${encodeURIComponent(savedId)}` : "/crm/opportunities");
        router.refresh();
      }}
    />
  );
}
