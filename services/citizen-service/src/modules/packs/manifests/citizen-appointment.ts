/**
 * pack:citizen-appointment — Citizen Appointment Booking (BRD §5.34 APPT-001..004).
 *
 * Lets a citizen book a face-to-face slot with a municipal office or officer.
 * The BRD requires:
 *
 *  APPT-001: Browse offices / desks, view available slots, book
 *  APPT-002: Reschedule and cancel (within a configurable window)
 *  APPT-003: Check-in on arrival; no-show auto-cancellation
 *  APPT-004: Link appointment to an existing application/case
 *
 * This is a booking-pattern pack — fee is optional (many ULBs offer appointments
 * free), B3 eligibility is hidden, and the output is a confirmation token.
 *
 * The confirmation lane is a single-lane auto-confirm by default (the officer's
 * calendar is the gate, not a manual approval). The pack carries a 1-day SLA
 * because the booking is near-instant when capacity exists — the SLA covers the
 * edge case where manual confirmation is needed (officer on leave, blocked slots).
 *
 * check-in and no-show (APPT-003) are workflow transitions, not form fields —
 * they happen at the counter, not in the citizen portal. The pack wires the lane
 * and the workflow handles the state transitions.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000403";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000403";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000403";

const S1 = "ap-sec-office";
const S2 = "ap-sec-schedule";
const S3 = "ap-sec-applicant";

export function citizenAppointmentFormDesign() {
  const fields = [
    field("ap-f1", "office", "Office / department", "picklist_single", S1, {
      choices: [
        "Property Tax",
        "Water Supply",
        "Sewerage",
        "Building Permission",
        "Trade Licence",
        "Revenue & Finance",
        "Health & Sanitation",
        "Town Planning",
        "General Administration",
        "Other",
      ],
      helpText: "Which office do you need to visit?",
    }),
    field("ap-f2", "ward", "Ward", "ward", S1),
    field("ap-f3", "purpose", "Purpose of visit", "text", S1, {
      helpText: "Brief reason — e.g. property mutation query, document submission, bill dispute.",
    }),
    field("ap-f4", "relatedApplicationNo", "Related application number", "text", S1, {
      required: false,
      helpText: "If this visit is about an existing application, enter its tracking number.",
    }),
    field("ap-f5", "preferredDate", "Preferred date", "date", S2),
    field("ap-f6", "preferredSlot", "Preferred time", "picklist_single", S2, {
      choices: [
        "10:00 – 10:30",
        "10:30 – 11:00",
        "11:00 – 11:30",
        "11:30 – 12:00",
        "12:00 – 12:30",
        "14:00 – 14:30",
        "14:30 – 15:00",
        "15:00 – 15:30",
        "15:30 – 16:00",
        "16:00 – 16:30",
      ],
      helpText: "30-minute slots. If this slot is taken you will be offered the nearest available one.",
    }),
    field("ap-f7", "applicantName", "Your name", "profile_name", S3),
    field("ap-f8", "applicantMobile", "Mobile number", "profile_mobile", S3, {
      helpText: "A reminder SMS will be sent the day before your appointment.",
    }),
    field("ap-f9", "applicantEmail", "Email", "profile_email", S3, { required: false }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Office and purpose" },
    { id: S2, label: "Schedule" },
    { id: S3, label: "Your details" },
  ], FORM_ID);
}

export function citizenAppointmentManifestBlocks() {
  const form = citizenAppointmentFormDesign();
  return {
    description:
      "Book a face-to-face appointment at a municipal office. Choose your office, date and " +
      "time slot. A confirmation token will be issued — present it at the reception on arrival.",
    slaDays: 1,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "flat" as const,
    hoaCode: "1606",
    issuanceType: "confirmation",
    outputs: [
      { type: "confirmation", templateKey: "ap-appointment-token", numberingFormat: "APT/{ward}/{year}/{seq:6}" },
    ],
    requiredDocuments: [],
    laneBindings: [
      {
        key: "confirmation",
        name: "Slot confirmation",
        enabled: true,
        designationId: "reception_clerk",
        designationLabel: "Reception Clerk",
        slaDays: 1,
        escalationDesignationId: "office_superintendent",
        escalationDesignationLabel: "Office Superintendent",
      },
    ],
    feeFromMinor: rupees(0),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile", "assisted", "whatsapp"],
    renewalPolicy: {
      renewable: false,
    },
  };
}

export function citizenAppointmentPackManifest() {
  return { businessService: "APT", pilot: false, blocks: citizenAppointmentManifestBlocks() };
}
