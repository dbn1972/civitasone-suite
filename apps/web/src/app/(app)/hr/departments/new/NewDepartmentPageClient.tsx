"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { AddDepartmentForm } from "./AddDepartmentForm";
import type { MinimalDept } from "@/lib/hr/departmentTree";

/**
 * The interactive part of /hr/departments/new (useRouter + the form's
 * onCancel/onSuccess closures). Split out from page.tsx so page.tsx itself
 * can be a plain server component that checks the session role BEFORE any
 * client code runs -- a Server Component can't pass function props like
 * onCancel/onSuccess to a Client Component, so the role check and the
 * interactive content can't live in the same "use client" file the way
 * this used to be a single file.
 *
 * GAP-HR-DEPARTMENTS-NEW-03: this used to force a router.push back to the
 * list 1.5s after every successful add, with no way to add several
 * departments in a row (and the timeout was never cleared on unmount). The
 * redirect is now an explicit, user-driven choice instead -- same pattern as
 * hr/designations/new/NewDesignationPageClient.tsx.
 */
export function NewDepartmentPageClient({ departments }: { departments: MinimalDept[] }) {
  const t = useTranslations("addDepartmentForm");
  const router = useRouter();
  const [justAdded, setJustAdded] = useState(false);

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/departments"
        backLabel={t("pageBackLabel")}
      />
      <AddDepartmentForm
        departments={departments}
        onCancel={() => { router.push("/hr/departments"); }}
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
              onClick={() => router.push("/hr/departments")}
            >
              {t("viewList")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
