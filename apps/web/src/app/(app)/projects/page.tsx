import { ModuleHub } from "../../_components/ModuleHub";
import { getSessionRoles, hasAnyRole, PROJECT_WRITE_ROLES } from "@/lib/auth/roleGuard";

export default function Page() {
  // GAP-PROJECTS-HOME-01: "+ New Project" is a create action, not navigation.
  // Only project managers/officers (project-service PROJ_ROLES) may create a
  // project; the server 403s others at POST. Filter the create tile out for
  // everyone else so a user without create rights isn't led to a form that
  // only fails at submit. The list page offers the same gated action, and
  // /projects/new shows a no-access state (defence-in-depth; the service
  // remains the authority).
  const canCreate = hasAnyRole(getSessionRoles(), PROJECT_WRITE_ROLES);

  const links = [
    { href: "/projects/dashboard", label: "Dashboard", note: "PMU overview — RAG status and KPIs" },
    { href: "/projects/list", label: "Projects", note: "All projects with budget and status" },
    ...(canCreate
      ? [{ href: "/projects/new", label: "+ New Project", note: "Create a new project entry" }]
      : []),
    { href: "/projects/schemes", label: "Schemes", note: "Government scheme catalog" },
    { href: "/projects/milestones", label: "Milestones", note: "Milestone tracking across projects" },
    { href: "/projects/fund-releases", label: "Fund Releases", note: "Release tracking" },
    { href: "/projects/utilization", label: "Utilization", note: "Fund utilization monitoring" },
    { href: "/projects/dpr-tracking", label: "DPR Tracking", note: "Detailed Project Report status" },
    { href: "/projects/wbs", label: "WBS", note: "Work Breakdown Structure" },
    { href: "/projects/delay-analysis", label: "Delay Analysis", note: "RAG status and delay causes" },
    { href: "/projects/escalations", label: "Escalations", note: "Risk alerts and escalation queue" },
    { href: "/projects/beneficiaries", label: "Beneficiaries", note: "Beneficiary tracking and verification" },
  ];

  return (
    <ModuleHub
      title="Projects & Scheme Management"
      description="DPR tracking, scheme monitoring, fund utilization, milestone oversight and beneficiary management."
      help="projects"
      links={links}
    />
  );
}
