"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../_components/ds";
import { AddLocationForm } from "./AddLocationForm";

export default function NewLocationPage() {
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
