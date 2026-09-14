"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { AddDesignationForm } from "./AddDesignationForm";

export default function NewDesignationPage() {
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
