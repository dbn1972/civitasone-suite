import Link from "next/link";
import { PageHeader, Card, StatusPill, ProgressBar } from "../../_components/ds";
import { getLocations, getTenantUsers, getTenantSettings } from "../../_data/loaders";

export const metadata = {
  title: "Getting Started",
};

type Step = {
  num: number;
  icon: string;
  title: string;
  /** One-line, plain explanation of what this step is for. */
  explanation: string;
  /** A concrete, friendly example so the clerk knows exactly what to type. */
  example: string;
  /** Label for the primary action button. */
  cta: string;
  /** Link to the existing page that does the work. */
  href: string;
  /** Whether we could confirm this step is already done. */
  done: boolean;
  /**
   * True when we can actually measure "done" from real data. When false, we
   * never claim it is done — we just show "To do" with the CTA.
   */
  measurable: boolean;
};

export default async function SetupPage() {
  // Pull a few cheap signals so we can tick off steps the clerk has already
  // finished. On any error these loaders return empty data, so we simply show
  // "To do" rather than fabricating progress.
  const [locations, users, modules] = await Promise.all([
    getLocations(),
    getTenantUsers(),
    getTenantSettings(),
  ]);

  const branchesDone = locations.source !== "error" && locations.data.length >= 1;
  const teamDone = users.source !== "error" && users.data.length > 1;
  const modulesDone = modules.source !== "error" && modules.data.length >= 1;

  // The finishing step is "done" once the parts we can measure are in place.
  const readyDone = branchesDone && teamDone && modulesDone;

  const steps: Step[] = [
    {
      num: 1,
      icon: "🏢",
      title: "Tell us about your office",
      explanation: "Add your office name, address, and a few basic details so everything is labelled correctly.",
      example: "e.g. District Industries Centre, Bhubaneswar",
      cta: "Add office details",
      href: "/tenant-admin/settings",
      done: false,
      measurable: false,
    },
    {
      num: 2,
      icon: "📍",
      title: "Add your branch offices",
      explanation: "Add your head office first, then add branches under it. You can pick which office each branch reports to.",
      example: "e.g. Head Office → Bhubaneswar Branch, Cuttack Branch",
      cta: "Add offices",
      href: "/locations/list",
      done: branchesDone,
      measurable: true,
    },
    {
      num: 3,
      icon: "🗂️",
      title: "Set up departments",
      explanation: "Create the teams in your office so you can sort people and work by department.",
      example: "e.g. Finance, HR, Establishment",
      cta: "Add departments",
      href: "/hr",
      done: false,
      measurable: false,
    },
    {
      num: 4,
      icon: "👋",
      title: "Invite your team",
      explanation: "Add the people who will use the system and choose what each person can do.",
      example: "e.g. Invite a clerk to enter bills, an officer to approve them",
      cta: "Invite people",
      href: "/tenant-admin/users",
      done: teamDone,
      measurable: true,
    },
    {
      num: 5,
      icon: "🧩",
      title: "Choose the modules you need",
      explanation: "Turn on only the parts you use — Finance, HR, Procurement. You can change this anytime.",
      example: "e.g. Switch on Finance and HR, leave the rest off for now",
      cta: "Choose modules",
      href: "/tenant-admin/settings",
      done: modulesDone,
      measurable: true,
    },
    {
      num: 6,
      icon: "🎉",
      title: "You're ready",
      explanation: "Your workspace is set up. Here's where to go next.",
      example: "Open your dashboard, or browse the help centre any time you're unsure.",
      cta: "Go to dashboard",
      href: "/dashboard",
      done: readyDone,
      measurable: true,
    },
  ];

  const totalSteps = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const progressPct = Math.round((doneCount / totalSteps) * 100);

  let encouragement: string;
  if (doneCount === 0) {
    encouragement = "Let's get your workspace ready — one small step at a time.";
  } else if (doneCount >= totalSteps) {
    encouragement = "All done — your workspace is ready to go. 🎉";
  } else if (doneCount >= totalSteps - 2) {
    encouragement = "Nice — you're almost there!";
  } else {
    encouragement = "Great start. Keep going whenever you have a moment.";
  }

  return (
    <section className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Getting Started"
        subtitle="A few quick steps to set up your office. There's no rush — do them in any order, and finish the rest later."
      />

      <Card padding>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>
            {doneCount} of {totalSteps} steps done
          </strong>
          <span style={{ color: "var(--mut)", fontSize: 13 }}>{encouragement}</span>
        </div>
        <ProgressBar value={progressPct} />
      </Card>

      <div className="grid g-2" style={{ marginTop: 16 }}>
        {steps.map((step) => {
          const isReadyStep = step.num === totalSteps;
          return (
            <Card key={step.num}>
              <div className="pad">
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span aria-hidden="true" style={{ fontSize: 22 }}>{step.icon}</span>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--mut)", fontWeight: 600 }}>Step {step.num}</div>
                      <h3 style={{ margin: 0, fontSize: 16, letterSpacing: "-0.2px" }}>{step.title}</h3>
                    </div>
                  </div>
                  <StatusPill
                    status={step.done ? "completed" : "draft"}
                    label={step.done ? "Done" : "To do"}
                  />
                </div>

                <p style={{ margin: "12px 0 6px", color: "var(--ink)", lineHeight: 1.5 }}>
                  {step.explanation}
                </p>
                <p style={{ margin: "0 0 14px", color: "var(--mut)", fontSize: 13, fontStyle: "italic" }}>
                  {step.example}
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <Link href={step.href} className="btn primary">
                    {step.done && !isReadyStep ? "Review" : step.cta}
                  </Link>
                  {!isReadyStep && (
                    <Link
                      href="/dashboard"
                      className="btn ghost"
                      aria-label={`Skip "${step.title}" and do it later`}
                    >
                      Do it later
                    </Link>
                  )}
                  {isReadyStep && (
                    <Link href="/knowledge" className="btn ghost">
                      Visit help centre
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <p style={{ marginTop: 18, color: "var(--mut)", fontSize: 13 }}>
        You can come back to this page any time from <strong>Getting Started</strong> in the menu. Nothing is lost if you step away.
      </p>
    </section>
  );
}
