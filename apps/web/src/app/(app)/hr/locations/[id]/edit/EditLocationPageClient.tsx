"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageHeader } from "../../../../../_components/ds";
import { AddLocationForm, type MinimalLocation } from "../../new/AddLocationForm";

type Editing = {
  id: string; name: string; type: string; parentId: string | null;
  addressLine: string | null; city: string | null; postalCode: string | null; lgdCode: string | null;
};

/** Interactive half of /hr/locations/[id]/edit (GAP-HR-LOCATIONS-02): the add form in edit mode. */
export function EditLocationPageClient({ editing, parents }: { editing: Editing; parents: MinimalLocation[] }) {
  const t = useTranslations("addLocationForm");
  const router = useRouter();
  return (
    <div className="page-main wrap">
      <PageHeader title={t("editPageTitle")} subtitle={editing.name} back="/hr/locations" backLabel={t("pageBackLabel")} />
      <AddLocationForm
        editing={editing}
        locations={parents}
        onCancel={() => router.push("/hr/locations")}
        onSuccess={() => { router.refresh(); router.push("/hr/locations"); }}
      />
    </div>
  );
}
