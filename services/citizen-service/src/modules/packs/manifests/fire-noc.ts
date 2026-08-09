/**
 * municipal-in-v1 / pack:fire-noc — Fire NOC (BRD §8.1.4).
 *
 * The BRD's third pilot: "same pattern as TL, different department". Its value
 * to the DoD is precisely that it should be boring — if a second Certificate
 * service in another department needs anything the Trade License pack did not,
 * the 8-block model has a hole.
 *
 * Two things it does carry that Trade License does not:
 *  - a risk category derived from occupancy and building height, which drives
 *    the fee slab (FN-04), and
 *  - MANDATORY renewal, which the BRD states explicitly. That is wired through
 *    FN-15 rather than left as prose, so the runtime actually opens a renewal
 *    window instead of the citizen discovering an expired NOC at inspection.
 */

const FN_FORM_ID = "cccccccc-0001-4000-8000-000000000203";
const FN_WORKFLOW = "cccccccc-0003-4000-8000-000000000203";
const FN_FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000203";

const S1 = "fn-sec-premises";
const S2 = "fn-sec-risk";
const S3 = "fn-sec-applicant";
const S4 = "fn-sec-docs";

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

export function fireNocFormDesign() {
  const fields = [
    field("fn-f1", "premisesName", "Name of premises", "text", S1),
    field("fn-f2", "premisesAddress", "Premises address", "textarea", S1),
    field("fn-f3", "ward", "Ward", "ward", S1),
    field("fn-f4", "occupancyType", "Occupancy type", "picklist_single", S2, {
      choices: [
        "Residential",
        "Educational",
        "Institutional / hospital",
        "Assembly (cinema, hall)",
        "Business",
        "Mercantile (shop, mall)",
        "Industrial",
        "Storage / warehouse",
        "Hazardous",
      ],
      helpText: "Occupancy and height together decide the risk category and the fee.",
    }),
    field("fn-f5", "buildingHeightM", "Building height (metres)", "number", S2, {
      helpText: "Measured from ground level to the top floor.",
    }),
    field("fn-f6", "numberOfFloors", "Number of floors", "number", S2),
    field("fn-f7", "builtUpAreaSqm", "Built-up area (sq m)", "number", S2),
    field("fn-f8", "applicantName", "Applicant name", "profile_name", S3),
    field("fn-f9", "applicantMobile", "Mobile number", "profile_mobile", S3),
    field("fn-f10", "ownerName", "Owner name", "text", S3, { required: false }),
    field("fn-f11", "buildingPlan", "Approved building plan", "file", S4, {
      fileTypes: ["pdf"],
      fileMaxMb: 10,
    }),
    field("fn-f12", "fireSafetyPlan", "Fire safety installation plan", "file", S4, {
      fileTypes: ["pdf"],
      fileMaxMb: 10,
      helpText: "Showing extinguishers, hydrants, alarms and escape routes.",
    }),
  ];

  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  return {
    sections: [
      { id: S1, label: "Premises", fieldIds: fields.filter((f) => f.sectionId === S1).map((f) => f.id) },
      { id: S2, label: "Occupancy and risk", fieldIds: fields.filter((f) => f.sectionId === S2).map((f) => f.id) },
      { id: S3, label: "Applicant", fieldIds: fields.filter((f) => f.sectionId === S3).map((f) => f.id) },
      { id: S4, label: "Documents", fieldIds: fields.filter((f) => f.sectionId === S4).map((f) => f.id) },
    ],
    fields: fieldMap,
    formId: FN_FORM_ID,
  };
}

export function fireNocManifestBlocks() {
  const form = fireNocFormDesign();
  return {
    description:
      "Apply for a Fire No Objection Certificate for your premises. A site inspection and risk " +
      "assessment are required. The NOC must be renewed every year.",
    slaDays: 21,
    formId: FN_FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FN_FORM_ID }],
    workflowDefinitionId: FN_WORKFLOW,
    feeScheduleId: FN_FEE_SCHEDULE,
    // Slab by occupancy and risk category — BRD §8.1.4, FN-04.
    feeModel: "slab" as const,
    hoaCode: "4210",
    issuanceType: "certificate",
    outputs: [
      { type: "certificate", templateKey: "fire-noc-certificate", numberingFormat: "FNOC/{ward}/{year}/{seq:5}" },
    ],
    requiredDocuments: [
      { docType: "building_plan", label: "Approved building plan", mandatory: true, verifiedAtLane: "site_inspection" },
      { docType: "fire_safety_plan", label: "Fire safety installation plan", mandatory: true, verifiedAtLane: "site_inspection" },
      { docType: "ownership_proof", label: "Proof of ownership or occupancy", mandatory: true, verifiedAtLane: "site_inspection" },
    ],
    /** FN-25 — inspection, then a separate risk assessment, then the decision. */
    laneBindings: [
      {
        key: "site_inspection",
        name: "Site inspection",
        enabled: true,
        designationId: "fire_inspector",
        designationLabel: "Fire Inspector",
        slaDays: 10,
        escalationDesignationId: "fire_station_officer",
        escalationDesignationLabel: "Fire Station Officer",
      },
      {
        key: "risk_assessment",
        name: "Risk assessment",
        enabled: true,
        designationId: "fire_station_officer",
        designationLabel: "Fire Station Officer",
        slaDays: 6,
        escalationDesignationId: "chief_fire_officer",
        escalationDesignationLabel: "Chief Fire Officer",
      },
      {
        key: "decision",
        name: "Decision",
        enabled: true,
        designationId: "chief_fire_officer",
        designationLabel: "Chief Fire Officer",
        slaDays: 5,
        escalationDesignationId: "municipal_commissioner",
        escalationDesignationLabel: "Municipal Commissioner",
      },
    ],
    feeFromMinor: 300000,
    feeCurrency: "INR",
    channels: ["portal", "counter"],
    /**
     * FN-15 — the BRD says renewal is mandatory for this service. Annual validity,
     * with the window opening 60 days out: fire safety renewal usually needs a
     * fresh inspection, so a 30-day window would routinely expire mid-process.
     */
    renewalPolicy: {
      renewable: true,
      renewalWindowDays: 60,
      validityMode: "duration" as const,
      validityYears: 1,
    },
    appealLinkage: {
      appealable: true,
      filingWindowDays: 30,
      appellateDesignationId: "municipal_commissioner",
      appellateDesignationLabel: "Municipal Commissioner",
    },
  };
}

export function fireNocPackManifest() {
  return {
    businessService: "FIRENOC",
    pilot: false,
    blocks: fireNocManifestBlocks(),
  };
}
