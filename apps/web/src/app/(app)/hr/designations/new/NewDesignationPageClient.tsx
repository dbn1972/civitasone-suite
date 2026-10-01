"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { AddDesignationForm } from "./AddDesignationForm";

/**
 * The interactive part of /hr/designations/new (useRouter + the form's
 * onCancel/onSuccess closures). Split out from page.tsx for the same reason
 * as hr/departments/new/NewDepartmentPageClient.tsx: a Server Component
 * can't pass function props to a Client Component, so the role check
 * (page.tsx) and the interactive content (here) can't share one file.
 *
 * GAP-HR-DESIGNATIONS-NEW-04: this used to force a router.push back to the
 * list 1.5s after every successful add, with no way to add several
 * designations in a row (and the timeout was never cleared on unmount).
 * The redirect is now an explicit, user-driven choice instead.
 */
export function NewDesignationPageClient() {
  const t = useTranslations("addDesignationForm");
  const router = useRouter();
  const [justAdded, setJustAdded] = useState(false);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/designations"
        backLabel={t("pageBackLabel")}
      />
      <AddDesignationForm
        onCancel={() => { router.push("/hr/designations"); }}
        onSuccess={() => {
          router.refresh();
          setJustAdded(true);
        }}
      />
      {justAdded && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="pad" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              className="btn"
              onClick={() => setJustAdded(false)}
            >
              {t("addAnother")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => router.push("/hr/designations")}
            >
              {t("viewList")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
