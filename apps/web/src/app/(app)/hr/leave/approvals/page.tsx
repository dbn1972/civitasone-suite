import { PageHeader } from "../../../../_components/ds";
import { LeaveApprovalsPanel } from "./LeaveApprovalsPanel";
import { getTranslations } from "next-intl/server";

export default async function LeaveApprovalsPage() {
  const t = await getTranslations("leaveApprovals");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/leave" backLabel="Back to Leave" />
      <LeaveApprovalsPanel />
    </div>
  );
}
