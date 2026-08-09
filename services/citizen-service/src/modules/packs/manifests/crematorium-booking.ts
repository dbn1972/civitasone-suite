/**
 * pack:crematorium-booking — Crematorium / burial ground slot booking.
 *
 * This pack is designed around the circumstances of the person filling it in.
 * A bereaved family is booking within hours of a death, often at night, usually
 * on a phone, and frequently without the death certificate yet — that is issued
 * after the cremation. So:
 *
 *  - the death certificate is NOT required; the medical cause-of-death slip or a
 *    hospital record is enough, and even that is optional for a home death;
 *  - there is a single lane with a one-day SLA, because a booking that needs
 *    two levels of approval is useless here;
 *  - the fee starts at zero — most municipalities operate electric crematoria
 *    free or near-free — and the slab covers only chargeable facilities;
 *  - "assisted" and "counter" channels are first-class, since many families will
 *    call or walk in rather than use a portal.
 *
 * Booking pattern: B3 eligibility is hidden, and nothing here should gate on it.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000305";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000305";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000305";

const S1 = "cr-sec-facility";
const S2 = "cr-sec-deceased";
const S3 = "cr-sec-applicant";

export function crematoriumFormDesign() {
  const fields = [
    field("cr-f1", "facility", "Facility", "picklist_single", S1, {
      choices: ["Electric crematorium", "Wood-pyre crematorium", "Burial ground", "Christian cemetery", "Muslim kabristan"],
    }),
    field("cr-f2", "ward", "Ward", "ward", S1),
    field("cr-f3", "slotDate", "Date", "date", S1),
    field("cr-f4", "slotTime", "Preferred time", "picklist_single", S1, {
      choices: ["Morning (6am–10am)", "Midday (10am–2pm)", "Afternoon (2pm–6pm)", "Evening (6pm–9pm)"],
      helpText: "If the slot is taken you will be offered the nearest available time.",
    }),
    field("cr-f5", "deceasedName", "Name of the deceased", "text", S2),
    field("cr-f6", "deceasedAge", "Age", "number", S2, { required: false }),
    field("cr-f7", "dateOfDeath", "Date of death", "date", S2),
    field("cr-f8", "placeOfDeath", "Place of death", "picklist_single", S2, {
      choices: ["Hospital", "Home", "Other"],
    }),
    field("cr-f9", "causeSlip", "Medical cause-of-death slip", "file", S2, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
      required: false,
      helpText: "If you have it. Not required for a death at home — the booking will not be held up for this.",
    }),
    field("cr-f10", "applicantName", "Your name", "profile_name", S3),
    field("cr-f11", "applicantMobile", "Mobile number", "profile_mobile", S3),
    field("cr-f12", "relationToDeceased", "Relationship to the deceased", "picklist_single", S3, {
      choices: ["Spouse", "Son / daughter", "Parent", "Sibling", "Other relative", "Neighbour or friend", "Institution"],
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Facility and time" },
    { id: S2, label: "The deceased" },
    { id: S3, label: "Your details" },
  ], FORM_ID);
}

export function crematoriumManifestBlocks() {
  const form = crematoriumFormDesign();
  return {
    description:
      "Book a slot at a municipal crematorium or burial ground. You do not need the death " +
      "certificate to book — that is issued afterwards. Bookings are usually confirmed the same day.",
    slaDays: 1,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "slab" as const,
    hoaCode: "1602",
    issuanceType: "confirmation",
    outputs: [
      { type: "confirmation", templateKey: "cr-booking-slip", numberingFormat: "CRM/{ward}/{year}/{seq:5}" },
    ],
    // Nothing mandatory. Requiring a document here would delay a cremation.
    requiredDocuments: [],
    laneBindings: [
      {
        key: "confirmation",
        name: "Slot confirmation",
        enabled: true,
        designationId: "crematorium_supervisor",
        designationLabel: "Crematorium Supervisor",
        slaDays: 1,
        escalationDesignationId: "health_officer",
        escalationDesignationLabel: "Health Officer",
      },
    ],
    feeFromMinor: rupees(0),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile", "assisted", "whatsapp"],
  };
}

export function crematoriumPackManifest() {
  return { businessService: "CRM", pilot: false, blocks: crematoriumManifestBlocks() };
}
