import { PageHeader } from "../../../_components/ds";
import { NotificationsPanel } from "./NotificationsPanel";

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="eOffice Notifications"
        subtitle="Overdue files, drafts awaiting approval or dispatch, and recent decisions — in one stream."
        back="/estab/list"
      />
      <NotificationsPanel />
    </>
  );
}
