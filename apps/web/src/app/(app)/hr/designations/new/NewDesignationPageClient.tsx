"use client";

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
 */
export function NewDesignationPageClient() {
  const t = useTranslations("addDesignationForm");
  const router = useRouter();
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
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
          setTimeout(() => { router.push("/hr/designations"); }, 1500);
        }}
      />
    </main>
  );
}
