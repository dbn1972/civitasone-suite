import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Projects & Scheme Management"
      description="DPR tracking, scheme monitoring, fund utilization, milestone oversight and beneficiary management."
      help="projects"
      links={[
        { href: "/projects/dashboard", label: "Dashboard", note: "PMU overview — RAG status and KPIs" },
        { href: "/projects/list", label: "Projects", note: "All projects with budget and status" },
        { href: "/projects/new", label: "+ New Project", note: "Create a new project entry" },
        { href: "/projects/schemes", label: "Schemes", note: "Government scheme catalog" },
        { href: "/projects/milestones", label: "Milestones", note: "Milestone tracking across projects" },
        { href: "/projects/fund-releases", label: "Fund Releases", note: "Release tracking" },
        { href: "/projects/utilization", label: "Utilization", note: "Fund utilization monitoring" },
        { href: "/projects/dpr-tracking", label: "DPR Tracking", note: "Detailed Project Report status" },
        { href: "/projects/wbs", label: "WBS", note: "Work Breakdown Structure" },
        { href: "/projects/delay-analysis", label: "Delay Analysis", note: "RAG status and delay causes" },
        { href: "/projects/escalations", label: "Escalations", note: "Risk alerts and escalation queue" },
        { href: "/projects/beneficiaries", label: "Beneficiaries", note: "Beneficiary tracking and verification" },
      ]}
    />
  );
}
