"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { AddLocationForm, type MinimalLocation } from "./AddLocationForm";

/**
 * The interactive part of /hr/locations/new (useRouter + the form's
 * onCancel/onSuccess closures). Split out from page.tsx so page.tsx itself
 * can be a plain server component that checks the session role BEFORE any
 * client code runs (see hr/departments/new/NewDepartmentPageClient.tsx for
 * the same split).
 *
 * GAP-HR-LOCATIONS-NEW-04: this used to force a router.push back to the
 * list 1.5s after every successful add, with no way to add several
 * locations in a row (and the timeout was never cleared on unmount). The
 * redirect is now an explicit, user-driven choice instead -- same pattern as
 * hr/departments/new/NewDepartmentPageClient.tsx and hr/designations/new/
 * NewDesignationPageClient.tsx.
 */
export function NewLocationPageClient({ locations }: { locations: MinimalLocation[] }) {
  const t = useTranslations("addLocationForm");
  const router = useRouter();
  const [justAdded, setJustAdded] = useState(false);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/locations"
        backLabel={t("pageBackLabel")}
      />
      <AddLocationForm
        locations={locations}
        onCancel={() => { router.push("/hr/locations"); }}
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
              onClick={() => router.push("/hr/locations")}
            >
              {t("viewList")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
