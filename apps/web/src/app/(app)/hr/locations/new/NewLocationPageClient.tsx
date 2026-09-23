"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { AddLocationForm } from "./AddLocationForm";

/**
 * The interactive part of /hr/locations/new (useRouter + the form's
 * onCancel/onSuccess closures). Split out from page.tsx so page.tsx itself
 * can be a plain server component that checks the session role BEFORE any
 * client code runs -- a Server Component can't pass function props like
 * onCancel/onSuccess to a Client Component, so the role check and the
 * interactive content can't live in the same "use client" file (see
 * hr/departments/new/NewDepartmentPageClient.tsx for the same split).
 */
export function NewLocationPageClient() {
  const t = useTranslations("addLocationForm");
  const router = useRouter();
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/locations"
        backLabel={t("pageBackLabel")}
      />
      <AddLocationForm
        onCancel={() => { router.push("/hr/locations"); }}
        onSuccess={() => {
          router.refresh();
          setTimeout(() => { router.push("/hr/locations"); }, 1500);
        }}
      />
    </main>
  );
}
