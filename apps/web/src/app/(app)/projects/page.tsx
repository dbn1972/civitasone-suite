import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Projects"
      description="Project management, scheme monitoring, fund tracking and milestone oversight."
      links={[
        { href: "/projects/dashboard", label: "Dashboard", note: "PMU overview — KPIs and quick links" },
        { href: "/projects/list", label: "Projects List", note: "All projects with budget and status" },
        { href: "/projects/milestones", label: "Milestones", note: "Milestone tracking across projects" },
        { href: "/projects/fund-releases", label: "Fund Releases", note: "Release tracking and utilisation" },
        { href: "/projects/schemes", label: "Schemes", note: "Government scheme catalog" },
      ]}
    />
  );
}
