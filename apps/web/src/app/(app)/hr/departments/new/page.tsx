"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { AddDepartmentForm } from "./AddDepartmentForm";

export default function NewDepartmentPage() {
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
