/**
 * Plain-language help content for CivitasOne modules.
 *
 * Written for a lower-level government office clerk with no training and no IT
 * background. Every module guide answers three questions a first-time user has:
 *   1. What is this for?  (one warm sentence)
 *   2. How do I do the common jobs?  (numbered, everyday-language steps)
 *   3. What do these words mean?  (the specialist terms, in plain English)
 *
 * The term explanations are pulled from the shared glossary so the wording is
 * identical to the "?" tooltips that appear on the screens themselves.
 */
import { explain } from "./glossary";

export type HelpTask = {
  /** A plain, action-named task, e.g. "Record a bill". */
  title: string;
  /** Numbered steps in everyday language. */
  steps: string[];
};

export type HelpModule = {
  /** URL slug, e.g. "finance". */
  slug: string;
  icon: string;
  /** Plain title shown to the clerk. */
  title: string;
  /** One warm sentence: what this module is for. */
  summary: string;
  /** Where to go to actually use the module. */
  href: string;
  /** Common jobs, described step by step. */
  tasks: HelpTask[];
  /** Specialist terms used in this module (looked up in the glossary). */
  terms: string[];
  /** Module key for tenant enablement gating; null = always available. (R13.2) */
  moduleKey: string | null;
  /** True for the nine Major Modules requiring full verifiable coverage. (R3.3) */
  major: boolean;
};

/** The nine Major Modules that must each have a complete guide. */
export const MAJOR_MODULE_SLUGS = [
  "hr",
  "payroll",
  "finance",
  "procurement",
  "estab",
  "grants",
  "projects",
  "citizen",
  "tenant-admin",
] as const;

export const HELP_MODULES: HelpModule[] = [
  {
    slug: "finance",
    icon: "🏦",
    title: "Finance",
    summary:
      "Look after your office's money — budgets, bills, payments, and the official account books.",
    href: "/finance",
    moduleKey: "finance",
    major: true,
    tasks: [
      {
        title: "Record and pay a bill",
        steps: [
          "Open Finance, then Bill Processing.",
          "Add a new bill with the vendor, amount, and what it is for.",
          "Send it for approval. An officer checks and approves it.",
          "Once approved, raise the payment. The system keeps the account books in balance for you.",
        ],
      },
      {
        title: "Check what budget is left",
        steps: [
          "Open Finance, then Budget Allocation.",
          "Pick the head of account you want to check.",
          "You'll see how much was set aside, spent, and what's left.",
        ],
      },
      {
        title: "Submit a Utilisation Certificate",
        steps: [
          "Open Finance, then Utilisation Certificates.",
          "Choose the grant or scheme the money came from.",
          "Enter how the money was spent and attach the proof.",
          "Send it for approval.",
        ],
      },
    ],
    terms: ["Sanction", "Budget", "GL", "Voucher", "UC", "Advance", "TDS", "PFMS", "DBT", "3-way match", "BE", "RE"],
  },
  {
    slug: "procurement",
    icon: "🛒",
    title: "Procurement",
    summary: "Buy goods and services the right way — from a request to choosing a supplier to receiving the delivery.",
    href: "/procurement",
    moduleKey: "procurement",
    major: true,
    tasks: [
      {
        title: "Raise a request to buy something",
        steps: [
          "Open Procurement, then Indents.",
          "Add a new indent listing what you need and how many.",
          "Send it for approval.",
        ],
      },
      {
        title: "Ask suppliers for prices",
        steps: [
          "Open Procurement, then RFQ (Request for Quotation).",
          "Pick the items and the suppliers to ask.",
          "Send it out and wait for their prices to come back.",
        ],
      },
      {
        title: "Check a delivery when it arrives",
        steps: [
          "Open the purchase order the delivery is against.",
          "Create a Goods Received Note (GRN).",
          "Tick off what arrived and flag anything missing or damaged.",
        ],
      },
    ],
    terms: ["Indent", "RFQ", "PO", "GRN", "Tender", "Empanelment", "EMD", "Bank guarantee", "Reverse auction"],
  },
  {
    slug: "hr",
    icon: "👥",
    title: "HR",
    summary: "Manage your people — joining, attendance, leave, transfers, and yearly reviews. (Salaries are in the Payroll guide.)",
    href: "/hr",
    moduleKey: "hrms",
    major: true,
    tasks: [
      {
        title: "Apply for leave",
        steps: [
          "Open HR, then Apply Leave.",
          "Pick the type of leave and the dates.",
          "Add a short reason and submit. Your manager approves it.",
        ],
      },
      {
        title: "Fix a wrong attendance entry",
        steps: [
          "Open HR, then Regularisation.",
          "Find the day that's wrong and request a correction.",
          "Add a short reason and send it for approval.",
        ],
      },
      {
        title: "Do a yearly performance review (APAR)",
        steps: [
          "Open HR, then Appraisals (APAR).",
          "Start the review for the employee and the year.",
          "Fill in the assessment and send it on for the next stage.",
        ],
      },
    ],
    terms: ["APAR", "KRA", "TA-DA", "Deputation", "Regularisation", "LOP"],
  },
  {
    slug: "payroll",
    icon: "💰",
    title: "Payroll",
    summary: "Pay your people correctly — monthly salaries, provident fund and pension, tax, and pay scales.",
    href: "/hr/payroll",
    moduleKey: "hrms",
    major: true,
    tasks: [
      {
        title: "Run the monthly payroll",
        steps: [
          "Open HR, then Payroll Runs.",
          "Start a new run for the month.",
          "Check the figures, then send for approval before salaries go out.",
        ],
      },
      {
        title: "View or print a salary slip",
        steps: [
          "Open HR, then Salary Slips.",
          "Pick the employee and the month.",
          "Open the slip to view or print it.",
        ],
      },
      {
        title: "Check provident fund or pension figures",
        steps: [
          "Open HR, then GPF or NPS.",
          "Pick the employee to see their contributions so far.",
          "For retirees, open Pensioners to manage the pension order (PPO).",
        ],
      },
    ],
    terms: ["GPF", "NPS", "Gratuity", "Pay matrix", "CPC", "ESI", "PT", "PPO", "DDO", "LOP", "TDS"],
  },
  {
    slug: "estab",
    icon: "🏢",
    title: "Establishment",
    summary: "Run the office's day-to-day paperwork — files and notes, post, meetings, vehicles and the guest house.",
    href: "/estab",
    moduleKey: "establishment",
    major: true,
    tasks: [
      {
        title: "Move a file for approval",
        steps: [
          "Open Establishment, then Files.",
          "Open the file and add your note on the note sheet.",
          "Send it to the next desk for their note or approval.",
        ],
      },
      {
        title: "Record incoming or outgoing post (DAK)",
        steps: [
          "Open Establishment, then the DAK / Dispatch register.",
          "Add the letter with who it's from or to and the date.",
          "Mark it to the right desk to act on.",
        ],
      },
      {
        title: "Record minutes of a meeting",
        steps: [
          "Open Establishment, then Meetings.",
          "Open the meeting and write up the Minutes of Meeting (MOM).",
          "Save and share with attendees.",
        ],
      },
    ],
    terms: ["eOffice", "Note sheet", "DAK", "MOM"],
  },
  {
    slug: "grants",
    icon: "🎁",
    title: "Grants",
    summary: "Give out grant money to people and organisations, and track how it's spent.",
    href: "/grants",
    moduleKey: "grants",
    major: true,
    tasks: [
      {
        title: "Release a grant payment",
        steps: [
          "Open Grants and find the approved grant.",
          "Choose the instalment to release.",
          "Send the payment for approval.",
        ],
      },
      {
        title: "Track a Utilisation Certificate",
        steps: [
          "Open Grants, then UC Management.",
          "Find the grantee and check whether their certificate is due.",
          "Record it once received and verified.",
        ],
      },
    ],
    terms: ["Grantee", "Disbursement", "Installment", "Beneficiary", "UC", "Milestone"],
  },
  {
    slug: "projects",
    icon: "📊",
    title: "Projects",
    summary: "Plan and track projects — phases, tasks, milestones, and spending against budget.",
    href: "/projects",
    moduleKey: "projects",
    major: true,
    tasks: [
      {
        title: "Start a new project",
        steps: [
          "Open Projects, then add a new project.",
          "Enter the name, budget, and key dates.",
          "Break the work into phases and tasks so you can track progress.",
        ],
      },
      {
        title: "Update a milestone",
        steps: [
          "Open Projects, then Milestones.",
          "Find the milestone and update its status or date.",
          "Save — delays show up in the project's status.",
        ],
      },
    ],
    terms: ["DPR", "WBS", "Milestone", "Budget", "Beneficiary"],
  },
  {
    slug: "citizen",
    icon: "🪪",
    title: "Citizen Services",
    summary: "Handle requests from the public — information requests, complaints, and services.",
    href: "/citizen",
    moduleKey: "citizen",
    major: true,
    tasks: [
      {
        title: "Answer an information request (RTI)",
        steps: [
          "Open Citizen, then RTI.",
          "Open the request and read what's being asked.",
          "Prepare the reply and attach any records, then send it within the time limit.",
        ],
      },
      {
        title: "Resolve a complaint",
        steps: [
          "Open Citizen, then Grievances.",
          "Open the complaint and look into it.",
          "Record what you did and close it once resolved.",
        ],
      },
    ],
    terms: ["RTI", "Grievance", "Beneficiary"],
  },
  {
    slug: "tenant-admin",
    icon: "🛡️",
    title: "Office Admin",
    summary: "Set up your office — add branches and people, choose what each person can do, and turn modules on or off.",
    href: "/tenant-admin",
    moduleKey: null,
    major: true,
    tasks: [
      {
        title: "Add a person and set what they can do",
        steps: [
          "Open Office Admin, then Users.",
          "Invite the person with their name and email.",
          "Choose a role — this decides what they're allowed to do.",
        ],
      },
      {
        title: "Turn a module on or off",
        steps: [
          "Open Office Admin, then Settings.",
          "Turn on the parts you use, like Finance or HR.",
          "You can change this any time.",
        ],
      },
    ],
    terms: ["Role", "MFA", "SSO", "Maker-checker", "Break-glass", "LGD code"],
  },
];

/** Find a single module guide by its slug. */
export function getHelpModule(slug: string): HelpModule | undefined {
  return HELP_MODULES.find((m) => m.slug === slug);
}

/** Resolve a term to its plain definition (shared with the on-screen tooltips). */
export function defineTerm(term: string): string {
  return explain(term) ?? "";
}
