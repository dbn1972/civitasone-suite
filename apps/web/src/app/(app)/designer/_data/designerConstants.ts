export const SERVICE_PATTERN_OPTIONS = [
  {
    id: "certificate",
    title: "Certificate / Permission",
    description: "Licences, NOCs, registrations, and character certificates.",
    examples: ["Trade License", "Fire NOC", "Birth Certificate"],
    activeBlocks: ["Catalogue", "Form", "Eligibility", "Approval chain", "Fee", "Documents", "Output", "Notifications"],
  },
  {
    id: "booking",
    title: "Booking / Reservation",
    description: "Hall booking, slot allocation, and appointments.",
    examples: ["Community hall", "Vehicle fitness slot", "Registrar appointment"],
    activeBlocks: ["Catalogue", "Form", "Fee", "Documents", "Output", "Notifications"],
  },
  {
    id: "collection",
    title: "Collection (fee-only)",
    description: "Self-assessment and fee payment without an approval gate.",
    examples: ["Property tax", "Amnesty scheme fee", "Professional tax"],
    activeBlocks: ["Catalogue", "Form", "Fee", "Output", "Notifications"],
  },
  {
    id: "grievance",
    title: "Grievance / Case",
    description: "Complaints, service requests, and case tracking.",
    examples: ["PGR complaint", "RTI-adjacent case", "Demand objection"],
    activeBlocks: ["Catalogue", "Form", "Eligibility", "Approval chain", "Documents", "Output", "Notifications"],
  },
] as const;

export const DEFAULT_BLOCKS = [
  { id: "b1", shortLabel: "B1", label: "Catalogue & Identity" },
  { id: "b2", shortLabel: "B2", label: "Intake Form" },
  { id: "b3", shortLabel: "B3", label: "Eligibility" },
  { id: "b4", shortLabel: "B4", label: "Approval Chain" },
  { id: "b5", shortLabel: "B5", label: "Fee & Revenue" },
  { id: "b6", shortLabel: "B6", label: "Documents" },
  { id: "b7", shortLabel: "B7", label: "Output & Issuance" },
  { id: "b8", shortLabel: "B8", label: "Notifications" },
] as const;

/** Blocks hidden per Service Pattern (FN-33 / UX §5.2). */
export function hiddenBlocksForPattern(pattern: string): Set<string> {
  switch (pattern) {
    case "booking":
      return new Set(["b3"]);
    case "collection":
      return new Set(["b3", "b4", "b6"]);
    case "grievance":
      return new Set(["b5"]);
    default:
      return new Set();
  }
}
