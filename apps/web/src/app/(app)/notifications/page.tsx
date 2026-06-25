import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Notifications"
      description="Notification inbox, delivery tracking, templates and sending."
      links={[
        { href: "/notifications/list", label: "Inbox", note: "All notification events" },
        { href: "/notifications/deliveries", label: "Deliveries", note: "Delivery status and failure log" },
        { href: "/notifications/templates", label: "Templates", note: "Message templates and versions" },
        { href: "/notifications/compose", label: "Send", note: "Send a notification from a template" },
      ]}
    />
  );
}
