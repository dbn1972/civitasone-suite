"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { AddDepartmentForm } from "./AddDepartmentForm";

/**
 * The interactive part of /hr/departments/new (useRouter + the form's
 * onCancel/onSuccess closures). Split out from page.tsx so page.tsx itself
 * can be a plain server component that checks the session role BEFORE any
 * client code runs -- a Server Component can't pass function props like
 * onCancel/onSuccess to a Client Component, so the role check and the
 * interactive content can't live in the same "use client" file the way
 * this used to be a single file.
 */
export function NewDepartmentPageClient() {
  const t = useTranslations("addDepartmentForm");
  const router = useRouter();
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/departments"
        backLabel={t("pageBackLabel")}
      />
      <AddDepartmentForm
        onCancel={() => { router.push("/hr/departments"); }}
        onSuccess={() => {
          router.refresh();
          setTimeout(() => { router.push("/hr/departments"); }, 1500);
        }}
      />
    </main>
  );
}
