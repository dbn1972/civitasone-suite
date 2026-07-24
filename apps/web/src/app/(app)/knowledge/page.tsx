import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Knowledge & DMS"
      description="Document repository, records management, governed SOP/policy lifecycle, FAQ and virtual assistant."
      links={[
        { href: "/knowledge/dashboard", label: "Dashboard", note: "Repository overview and stats" },
        { href: "/knowledge/repository", label: "Repository", note: "Documents, policies, circulars" },
        { href: "/knowledge/policies", label: "SOPs & Policies", note: "Governed lifecycle, approvals, acknowledgements" },
        { href: "/knowledge/faqs", label: "FAQ & Guided Support", note: "Browse FAQs and step-by-step guides" },
        { href: "/knowledge/assistant", label: "Virtual Assistant", note: "Grounded Q&A with citations, escalate to ticket" },
        { href: "/knowledge/records", label: "Records Management", note: "Retention and disposal" },
        { href: "/knowledge/search", label: "Search", note: "Enterprise full-text search" },
      ]}
    />
  );
}
