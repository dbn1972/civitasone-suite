import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Notifications"
      description="Notification inbox and delivery tracking."
      links={[
        { href: "/notifications/list", label: "Inbox", note: "All notification events" },
        { href: "/notifications/deliveries", label: "Deliveries", note: "Delivery status and failure log" },
      ]}
    />
  );
}
