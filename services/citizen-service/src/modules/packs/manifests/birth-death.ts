/**
 * municipal-in-v1 / pack:birth-death — Birth & Death Registration (BRD §8.1.6).
 *
 * THIS PACK CANNOT PASS SANDBOX TEST TODAY, AND THAT IS CORRECT.
 *
 * It binds `crs.birth-death`, which ENGINE_KEYS marks `available: false`
 * ("CRS engine binding is parameter-only until the registrar adapter ships").
 * FN-10's honesty rule says a pack bound to an unavailable engine must fail its
 * sandbox test, so this pack will fail until the adapter is deployed. Shipping
 * it in that state is deliberate: the alternative — omitting the binding so the
 * pack goes green — would let a registrar publish a statutory service that
 * silently issues certificates the civil registration system knows nothing
 * about. A red sandbox is the accurate signal.
 *
 * FIELD MODEL IS PROVISIONAL. The BRD says outright: "verify UPYOG
 * `birth-death-services` before build". These fields are modelled from the BRD
 * text alone and must be checked against the real UPYOG contract before this
 * pack is published in any tenant. Registration is statutory; a wrong field here
 * is a wrong legal record, not a cosmetic defect.
 */

const BD_FORM_ID = "cccccccc-0001-4000-8000-000000000205";
const BD_WORKFLOW = "cccccccc-0003-4000-8000-000000000205";
const BD_FEE_SCHEDULE = "cccccccc-0004-4000-8000-000000000205";
const BD_ENGINE_BINDING_ID = "cccccccc-0005-4000-8000-000000000205";

const S1 = "bd-sec-event";
const S2 = "bd-sec-registrant";
const S3 = "bd-sec-informant";
const S4 = "bd-sec-docs";

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

export function birthDeathFormDesign() {
  const fields = [
    field("bd-f1", "eventType", "Event to register", "picklist_single", S1, {
      choices: ["Birth", "Death"],
    }),
    field("bd-f2", "eventDate", "Date of event", "date", S1, {
      helpText: "Registration after 21 days may need an order from the registrar.",
    }),
    field("bd-f3", "eventPlaceType", "Place of event", "picklist_single", S1, {
      choices: ["Hospital / institution", "Home", "Other"],
    }),
    field("bd-f4", "institutionName", "Hospital or institution", "text", S1, {
      required: false,
      helpText: "If the event took place in a hospital or nursing home.",
    }),
    field("bd-f5", "eventAddress", "Address where the event took place", "textarea", S1),
    field("bd-f6", "ward", "Ward", "ward", S1),
    field("bd-f7", "registrantName", "Name of the person", "text", S2, {
      required: false,
      helpText: "May be left blank for a newborn not yet named.",
    }),
    field("bd-f8", "registrantGender", "Gender", "picklist_single", S2, {
      choices: ["Male", "Female", "Transgender"],
    }),
    field("bd-f9", "fatherName", "Father's name", "text", S2, { required: false }),
    field("bd-f10", "motherName", "Mother's name", "text", S2, { required: false }),
    field("bd-f11", "informantName", "Informant's name", "profile_name", S3),
    field("bd-f12", "informantMobile", "Mobile number", "profile_mobile", S3),
    field("bd-f13", "informantRelation", "Relationship to the person", "picklist_single", S3, {
      choices: ["Parent", "Spouse", "Child", "Other relative", "Hospital official", "Other"],
    }),
    field("bd-f14", "informantAddress", "Informant's address", "textarea", S3),
    field("bd-f15", "institutionCertificate", "Hospital certificate", "file", S4, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
      required: false,
      helpText: "The discharge or death summary, if the event took place in an institution.",
    }),
    field("bd-f16", "informantIdProof", "Informant's identity proof", "file", S4, {
      fileTypes: ["pdf", "jpg"],
      fileMaxMb: 5,
    }),
  ];

  const fieldMap = Object.fromEntries(fields.map((f) => [f.id, f]));

  return {
    sections: [
      { id: S1, label: "The event", fieldIds: fields.filter((f) => f.sectionId === S1).map((f) => f.id) },
      { id: S2, label: "The person", fieldIds: fields.filter((f) => f.sectionId === S2).map((f) => f.id) },
      { id: S3, label: "Informant", fieldIds: fields.filter((f) => f.sectionId === S3).map((f) => f.id) },
      { id: S4, label: "Documents", fieldIds: fields.filter((f) => f.sectionId === S4).map((f) => f.id) },
    ],
    fields: fieldMap,
    formId: BD_FORM_ID,
  };
}

export function birthDeathManifestBlocks() {
  const form = birthDeathFormDesign();
  return {
    description:
      "Register a birth or death and obtain the certificate. Registration is free within 21 days " +
      "of the event; a late fee applies after that.",
    slaDays: 7,
    formId: BD_FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: BD_FORM_ID }],
    workflowDefinitionId: BD_WORKFLOW,
    feeScheduleId: BD_FEE_SCHEDULE,
    // Slab: free inside the statutory window, late fee beyond it.
    feeModel: "slab" as const,
    hoaCode: "1475",
    issuanceType: "certificate",
    outputs: [
      { type: "certificate", templateKey: "bd-certificate", numberingFormat: "BD/{ward}/{year}/{seq:6}" },
    ],
    requiredDocuments: [
      { docType: "informant_id_proof", label: "Informant's identity proof", mandatory: true, verifiedAtLane: "verification" },
      { docType: "institution_certificate", label: "Hospital certificate", mandatory: false, verifiedAtLane: "verification" },
    ],
    laneBindings: [
      {
        key: "verification",
        name: "Verification",
        enabled: true,
        designationId: "registrar_clerk",
        designationLabel: "Registration Clerk",
        slaDays: 4,
        escalationDesignationId: "registrar",
        escalationDesignationLabel: "Registrar (Births & Deaths)",
      },
      {
        key: "registration",
        name: "Registration",
        enabled: true,
        designationId: "registrar",
        designationLabel: "Registrar (Births & Deaths)",
        slaDays: 3,
        escalationDesignationId: "district_registrar",
        escalationDesignationLabel: "District Registrar",
      },
    ],
    /**
     * FN-21 — bound to the civil registration system. `available: false` today,
     * so FN-10 will fail this pack's sandbox test until the registrar adapter
     * ships. requiredForPublish stays true: a statutory register that does not
     * reach CRS is worse than a service that refuses to publish.
     */
    engineBindings: [
      {
        id: BD_ENGINE_BINDING_ID,
        block: "verification" as const,
        engineKey: "crs.birth-death" as const,
        requiredForPublish: true,
        config: {
          exemptionCategories: [],
          penaltyPercentBps: 0,
          penaltyGraceDays: 21,
          rebatePercentBps: 0,
          rebateWindowDays: 0,
          hoaCode: "1475",
          extras: { businessService: "BND" },
        },
      },
    ],
    feeFromMinor: 0,
    feeCurrency: "INR",
    channels: ["portal", "counter"],
  };
}

export function birthDeathPackManifest() {
  return {
    businessService: "BND",
    pilot: false,
    /**
     * Surfaced so onboarding can warn before activation rather than after a
     * failed sandbox run.
     */
    blockedByUnavailableEngine: "crs.birth-death",
    fieldModelStatus: "provisional — verify against UPYOG birth-death-services",
    blocks: birthDeathManifestBlocks(),
  };
}
