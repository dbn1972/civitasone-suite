/**
 * pack:municipal-property-rent — Rent and lease payment for municipal property.
 *
 * A COLLECTION service: the citizen already holds the shop, stall or lease and
 * is paying what is due. There is nothing to approve, so B3 eligibility, B4
 * approval chain and B6 documents are hidden for this pattern and the pack wires
 * none of them. Adding an approver to a rent payment would create a queue that
 * delays money the municipality has already earned.
 *
 * The output is a RECEIPT, not a certificate — nothing is granted here.
 *
 * Fee model is flat rather than engine-bound: the amount owed is the rent on the
 * allotment, looked up by property reference, not computed from a formula. If a
 * municipality later wants arrears interest calculated, that is a rate-engine
 * binding, not a change to this form.
 */

import { field, formDesignFrom, rupees } from "./_shared.js";

const FORM_ID = "cccccccc-0001-4000-8000-000000000308";

const S1 = "mp-sec-property";
const S2 = "mp-sec-period";
const S3 = "mp-sec-payer";

export function municipalPropertyRentFormDesign() {
  const fields = [
    field("mp-f1", "propertyReference", "Allotment or lease number", "text", S1, {
      helpText: "On your allotment order or last receipt.",
    }),
    field("mp-f2", "propertyType", "Type of property", "picklist_single", S1, {
      choices: ["Market shop or stall", "Municipal building shop", "Leased land", "Community hall (long lease)", "Advertising site"],
    }),
    field("mp-f3", "ward", "Ward", "ward", S1),
    field("mp-f4", "propertyAddress", "Property address", "textarea", S1, { required: false }),
    field("mp-f5", "paymentFor", "Paying for", "picklist_single", S2, {
      choices: ["Monthly rent", "Quarterly rent", "Annual lease rent", "Arrears", "Security deposit"],
    }),
    field("mp-f6", "periodFrom", "Period from", "date", S2),
    field("mp-f7", "periodTo", "Period to", "date", S2),
    field("mp-f8", "amountDue", "Amount being paid", "number", S2, {
      helpText: "As shown on your demand notice. Contact the market office if it does not match.",
    }),
    field("mp-f9", "payerName", "Name of the allottee", "profile_name", S3),
    field("mp-f10", "payerMobile", "Mobile number", "profile_mobile", S3, {
      helpText: "The receipt is sent here.",
    }),
  ];

  return formDesignFrom(fields, [
    { id: S1, label: "Property" },
    { id: S2, label: "Period and amount" },
    { id: S3, label: "Payer" },
  ], FORM_ID);
}

export function municipalPropertyRentManifestBlocks() {
  const form = municipalPropertyRentFormDesign();
  return {
    description:
      "Pay rent or lease charges for a municipal shop, stall or leased property. " +
      "A receipt is issued immediately once the payment succeeds.",
    slaDays: 1,
    formId: FORM_ID,
    forms: [{ formDesign: { sections: form.sections, fields: form.fields }, layoutId: FORM_ID }],
    // No workflowDefinitionId, no laneBindings, no requiredDocuments — the
    // collection pattern hides B4 and B6, and nothing here needs approving.
    feeModel: "flat" as const,
    hoaCode: "1605",
    issuanceType: "receipt",
    outputs: [
      { type: "receipt", templateKey: "mp-rent-receipt", numberingFormat: "MPR/{ward}/{year}/{seq:6}" },
    ],
    requiredDocuments: [],
    feeFromMinor: rupees(0),
    feeCurrency: "INR",
    channels: ["portal", "counter", "mobile"],
  };
}

export function municipalPropertyRentPackManifest() {
  return { businessService: "MPR", pilot: false, blocks: municipalPropertyRentManifestBlocks() };
}
