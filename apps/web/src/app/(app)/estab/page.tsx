import { ModuleHub } from "../../_components/ModuleHub";
import { ESTAB_ADMIN_ROLES, ESTAB_OPERATOR_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/**
 * Establishment hub.
 *
 * GAP-ESTAB-HOME-01: every built route now has a tile. Previously eight routes
 * (inbox/"My Desk", workspace/"Guided File", dfa, approval-matrix, operators,
 * handover, migration, notifications) were reachable only from the sub-nav on
 * /estab/list, so a clerk starting at the hub could not find "My Desk".
 *
 * GAP-ESTAB-HOME-04: the three administration tiles (Approval Matrix,
 * Operators, Migration) carry `roles`, so they are hidden from a session that
 * lacks the estab admin / division-admin role. This mirrors the server gate —
 * estab-service already 403s non-admins on the matching write endpoints
 * (modules/approval-rules/routes.ts ADMIN_ROLES; modules/operators/routes.ts
 * ADMIN_ROLES; modules/migration/routes.ts WRITER_ROLES) — so this only avoids
 * advertising a tile that would otherwise bounce the user. Grouping separates
 * Daily work from Administration.
 */
export default function EstabHubPage() {
  return (
    <ModuleHub
      title="Establishment"
      description="Run the office's day-to-day paperwork — files and notes, post, meetings, vehicles and the guest house."
      help="estab"
      groups={[
        {
          heading: "Daily work",
          links: [
            { href: "/estab/dashboard", label: "Dashboard", note: "Overview of all establishment activities" },
            { href: "/estab/inbox", label: "My Desk", note: "Files currently with you, by SLA" },
            { href: "/estab/workspace", label: "Guided File", note: "Open and route a file step by step" },
            { href: "/estab/list", label: "File Register", note: "Digital file tracking (eOffice)" },
            { href: "/estab/files/new", label: "New File", note: "Open a new digital file" },
            { href: "/estab/dak", label: "DAK Registry", note: "Inward dak receipt & file opening" },
            { href: "/estab/dfa", label: "Draft for Approval", note: "Draft letters pending approval & sign-off" },
            { href: "/estab/dispatch", label: "Dispatch", note: "Outward correspondence register" },
            { href: "/estab/approvals", label: "Approvals", note: "Yellow → green note approval queue" },
            { href: "/estab/handover", label: "Charge Handover", note: "Hand over desk charge and pending files" },
            { href: "/estab/notifications", label: "Notifications", note: "Establishment alerts & reminders" },
            { href: "/estab/compliance", label: "Compliance", note: "Action & decision compliance tracking" },
          ],
        },
        {
          heading: "Registers & facilities",
          links: [
            { href: "/estab/meetings", label: "Meetings", note: "Schedule, agenda, MOM & action tracking" },
            { href: "/estab/vehicles", label: "Fleet", note: "Vehicle management & logbook" },
            { href: "/estab/guesthouse", label: "Guest House", note: "Room bookings & occupancy" },
            { href: "/estab/quarters", label: "Residential Quarters", note: "Quarter inventory & allotment lifecycle" },
            { href: "/estab/library", label: "Staff Library", note: "Book catalogue, issues & returns" },
          ],
        },
        {
          heading: "Administration",
          links: [
            {
              href: "/estab/approval-matrix",
              label: "Approval Matrix",
              note: "Who signs sanctions, payments & disciplinary actions",
              roles: ESTAB_ADMIN_ROLES,
            },
            {
              href: "/estab/operators",
              label: "Operators",
              note: "Enrol & manage eOffice file operators",
              roles: ESTAB_OPERATOR_ADMIN_ROLES,
            },
            {
              href: "/estab/migration",
              label: "Data Migration",
              note: "Register & link migrated legacy files",
              roles: ESTAB_OPERATOR_ADMIN_ROLES,
            },
          ],
        },
      ]}
    />
  );
}
