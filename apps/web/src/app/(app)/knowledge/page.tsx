import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Knowledge & DMS"
      description="Document repository, records management, and enterprise search."
      links={[
        { href: "/knowledge/dashboard", label: "Dashboard", note: "Repository overview and stats" },
        { href: "/knowledge/repository", label: "Repository", note: "Documents, policies, circulars" },
        { href: "/knowledge/records", label: "Records Management", note: "Retention and disposal" },
        { href: "/knowledge/search", label: "Search", note: "Enterprise full-text search" },
      ]}
    />
  );
}
