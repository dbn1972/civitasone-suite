/**
 * pack:desludging-booking — Septage / Desludging Booking (BRD §5.5 SEWER-004).
 *
 * A booking-pattern pack for scheduled emptying of septic tanks and soak pits.
 * In areas without trunk sewerage, this is the primary sanitation service a ULB
 * provides — the tanker comes, empties the pit, and disposes at a designated
 * treatment plant. The BRD requires:
 *
 *  - citizen books a slot (date + time window);
 *  - fee by pit volume / tanker capacity;
 *  - crew confirms and dispatches;
 *  - field evidence (GPS of vehicle at property + disposal proof at treatment
 *    site) closes the job.
 *
 * Modelled on crematorium-booking (single-confirm lane, booking pattern), but
 * with a field-evidence closure lane because the service involves physical
 * dispatch — unlike a crematorium, where the citizen is present for the work.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000402";
const WORKFLOW = "cccccccc-0003-4000-8000-000000000402";
const FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000402";

const S1 = "ds-sec-property";
const S2 = "ds-sec-booking";
const S3 = "ds-sec-applicant";

export function desludgingFormDesign() {
  const fields = [
    field("ds-f1", "propertyAddress", "Property address", "textarea", S1, {
      helpText: "Include a landmark — the tanker driver needs to find the property.",
    }),
    field("ds-f2", "ward", "Ward", "ward", S1),
    field("ds-f3", "pitType", "Pit type", "picklist_single", S1, {
      choices: ["Septic tank", "Soak pit", "Holding tank", "Twin-pit latrine"],
    }),
    field("ds-f4", "estimatedVolume", "Estimated volume (litres)", "picklist_single", S1, {
      choices: ["Up to 1000", "1000–3000", "3000–6000", "Above 6000"],
      helpText: "Approximate capacity of your pit. Decides the tanker size and fee.",
    }),
    field("ds-f5", "preferredDate", "Preferred date", "date", S2),
    field("ds-f6", "preferredSlot", "Preferred time", "picklist_single", S2, {
      choices: ["Morning (7am–11am)", "Afternoon (12pm–4pm)", "Evening (4pm–7pm)"],
      helpText: "If the slot is unavailable you will be offered the nearest open window.",
    }),
    field("ds-f7", "accessNotes", "Access notes", "textarea", S2, {
      required: false,
      helpText: "Anything the tanker driver should know — narrow lane, locked gate, etc.",
    }),
    field("ds-f8", "applicantName", "Your name", "profile_name", S3),
    field("ds-f9", "applicantMobile", "Mobile number", "profile_mobile", S3, {
      helpText: "The driver will call this number on arrival.",
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Property and pit" },
    { id: S2, label: "Schedule" },
    { id: S3, label: "Your details" },
  ], FORM_ID);
}

export function desludgingManifestBlocks() {
  const form = desludgingFormDesign();
  return {
    description:
      "Book a municipal tanker to empty your septic tank or soak pit. The fee depends on " +
      "the pit volume. You will receive a confirmed date and time, and the driver's number on dispatch.",
    slaDays: 5,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    workflowDefinitionId: WORKFLOW,
    feeScheduleId: FEE_SCHEDULE,
    feeModel: "slab" as const,
    hoaCode: "1403",
    issuanceType: "confirmation",
    outputs: [
      { type: "confirmation", templateKey: "ds-dispatch-slip", numberingFormat: "DS/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [],
    laneBindings: [
      {
        key: "scheduling",
        name: "Schedule and dispatch",
        enabled: true,
        designationId: "sanitation_supervisor",
        designationLabel: "Sanitation Supervisor",
        slaDays: 2,
        escalationDesignationId: "health_officer",
        escalationDesignationLabel: "Health Officer",
      },
      {
        key: "field_closure",
        name: "Field evidence and closure",
        enabled: true,
        designationId: "tanker_operator",
        designationLabel: "Tanker Operator",
        slaDays: 3,
        escalationDesignationId: "sanitation_supervisor",
        escalationDesignationLabel: "Sanitation Supervisor",
      },
    ],
    feeFromMinor: rupees(500),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile", "assisted", "whatsapp"],
  };
}

export function desludgingPackManifest() {
  return { businessService: "DS", pilot: false, blocks: desludgingManifestBlocks() };
}
