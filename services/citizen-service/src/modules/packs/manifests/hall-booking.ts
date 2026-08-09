/**
 * general-admin-in-v1 / pack:hall-booking — non-municipal Booking pattern manifest.
 *
 * BRD §8.6 (General Administration): "Hall / vehicle booking | Booking | — | full pack".
 * No Engine Binding: slot/asset booking is Studio-composable, so this pack proves
 * the universality claim (DoD (g)) without any engineered backend.
 *
 * Booking pattern specifics (BRD §4.1): fee is charged UP FRONT (demand on
 * submission, not on approval) and the output is a confirmation/pass rather than
 * a certificate. B3 (eligibility) is hidden for this pattern — see
 * designerConstants.hiddenBlocksForPattern — so no eligibilityRuleSetId is wired.
 */

const HB_FORM_ID = "cccccccc-0001-4000-8000-000000000101";
const HB_WORKFLOW = "cccccccc-0003-4000-8000-000000000101";
const HB_FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000101";

const S1 = "hb-sec-booking";
const S2 = "hb-sec-applicant";
const S3 = "hb-sec-docs";

function field(
  id: string,
  apiName: string,
  label: string,
  type: string,
  sectionId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    apiName,
    type,
    label,
    required: extra.required === false ? false : true,
    sectionId,
    ...extra,
  };
}

export function hallBookingFormDesign() {
  const fields = [
    field("hb-f1", "facility", "Facility", "picklist_single", S1, {
      choices: ["Community hall", "Auditorium", "Open ground", "Meeting room"],
      helpText: "Which municipal facility do you want to book?",
    }),
    field("hb-f2", "bookingDate", "Booking date", "date", S1),
    field("hb-f3", "slot", "Time slot", "picklist_single", S1, {
      choices: ["Morning (9am–1pm)", "Afternoon (2pm–6pm)", "Evening (7pm–11pm)", "Full day"],
    }),
    field("hb-f4", "purpose", "Purpose of booking", "text", S1, {
      helpText: "For example: wedding reception, cultural programme, public meeting",
    }),
    field("hb-f5", "expectedAttendance", "Expected attendance", "number", S1, {
      helpText: "Used to check the facility's capacity",
    }),
    field("hb-f6", "applicantName", "Applicant name", "profile_name", S2),
    field("hb-f7", "applicantMobile", "Mobile number", "profile_mobile", S2),
    field("hb-f8", "applicantEmail", "Email", "profile_email", S2, { required: false }),
    field("hb-f9", "ward", "Ward", "ward", S2),
    field("hb-f10", "idProof", "Identity proof", "file", S3, { fileTypes: ["pdf", "jpg"], fileMaxMb: 5 }),
  ];

  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  return {
    sections: [
      { id: S1, label: "Booking details", fieldIds: fields.filter((f) => f.sectionId === S1).map((f) => f.id) },
      { id: S2, label: "Applicant details", fieldIds: fields.filter((f) => f.sectionId === S2).map((f) => f.id) },
      { id: S3, label: "Documents", fieldIds: fields.filter((f) => f.sectionId === S3).map((f) => f.id) },
    ],
    fields: fieldMap,
    formId: HB_FORM_ID,
  };
}

/** Stable block wiring applied on pack import. */
export function hallBookingManifestBlocks() {
  const form = hallBookingFormDesign();
  return {
    description:
      "Book a municipal hall, ground or meeting room. Payment is taken at the time of booking; " +
      "the booking is confirmed once the office approves availability.",
    slaDays: 3,
    formId: HB_FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: HB_FORM_ID }],
    // B3 eligibility is hidden for the Booking pattern — intentionally unwired.
    workflowDefinitionId: HB_WORKFLOW,
    feeScheduleId: HB_FEE_SCHEDULE,
    feeModel: "flat" as const,
    hoaCode: "1601",
    issuanceType: "confirmation",
    outputs: [
      { type: "confirmation", templateKey: "hb-booking-pass", numberingFormat: "HB/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "id_proof", label: "Identity proof", mandatory: true, verifiedAtLane: "availability" },
    ],
    /** FN-25 — Booking is a short two-lane chain; availability check then confirmation. */
    laneBindings: [
      {
        key: "availability",
        name: "Availability check",
        enabled: true,
        designationId: "facility_clerk",
        designationLabel: "Facility Clerk",
        slaDays: 1,
        escalationDesignationId: "facility_officer",
        escalationDesignationLabel: "Facility Officer",
      },
      {
        key: "confirmation",
        name: "Confirmation",
        enabled: true,
        designationId: "facility_officer",
        designationLabel: "Facility Officer",
        slaDays: 2,
        escalationDesignationId: "general_admin_head",
        escalationDesignationLabel: "General Administration Head",
      },
    ],
    feeFromMinor: 200000,
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile"],
  };
}

export function hallBookingPackManifest() {
  return {
    businessService: "HB",
    pilot: false,
    blocks: hallBookingManifestBlocks(),
  };
}
