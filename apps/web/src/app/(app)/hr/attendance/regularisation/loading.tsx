import { SkeletonTable } from "../../../../_components/ds";
import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function RegularisationLoading() {
  const t = await getTranslations("attendanceRegularisation");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitleLoading")}
        back="/hr/attendance" backLabel="Back to Attendance"
      />
      <div className="page-main wrap">
        <SkeletonTable rows={5} />
      </div>
    </>
  );
}
