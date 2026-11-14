/**
 * Section 8 / DIC: the STARTING CTC template, as seed/config DATA only (owner decision 1 and decision 4 of the second
 * set, 10 Nov 2026). It is NOT loaded anywhere: nothing imports it at runtime, no migration inserts it, and it must not
 * be loaded into the live UAT database. DIC finance confirms every value before go-live; the person who loads it into
 * the DIC tenant does so through the template screen/API (maker-checker), not from here.
 *
 * Every percentage below is a template value the tenant may change, never a code constant. VERIFY (statutory/legal,
 * nothing here is a statement of current law): the 50% basic share against the labour-code wage definition; the 4.81%
 * gratuity provision (15/26 x basic / 12) and gratuity eligibility of fixed-term staff; the PF wage ceiling the employer
 * PF is derived from (config row, Rs 15,000 today); the ESI ceiling and employer rate (config rows).
 *
 * HRA 50% of basic is the metro (Delhi) rate. Group insurance is deliberately absent: DIC has not given an amount.
 */
import type { ComponentSpec } from "../pay-components/model.js";

export const DIC_CTC_TEMPLATE_NAME = "Project Staff CTC - Delhi (DIC)";

const base = {
  isTaxable: true, pctOfBasic: null, pctOfCtcBps: null, fixedMinor: null, employerCostClass: null, costPlacement: "inside_ctc" as const,
  countsForPfWage: false, countsForEsiWage: true, countsForGratuity: false, lopApplicable: true,
};

export const DIC_CTC_TEMPLATE: readonly ComponentSpec[] = [
  { ...base, code: "BASIC", name: "Basic Pay", componentType: "earning", calc: "pct_of_ctc", pctOfCtcBps: 5000, countsForPfWage: true, countsForGratuity: true, payslipOrder: 10 },
  { ...base, code: "HRA", name: "House Rent Allowance", componentType: "earning", calc: "pct_of_basic", pctOfBasic: 50, payslipOrder: 20 },
  { ...base, code: "SPECIAL", name: "Special Allowance", componentType: "earning", calc: "balancing", payslipOrder: 30 },
  // Employer PF: derived from the effective-dated statutory config (12% on the PF wage ceiling). VERIFY.
  { ...base, code: "ER_PF", name: "Employer PF (EPF + EPS)", componentType: "employer_cost", calc: null, employerCostClass: "employer_pf", isTaxable: false, countsForEsiWage: false, lopApplicable: false, payslipOrder: 40 },
  // Employer ESI: derived from config, only while the employee is under the ESI ceiling. VERIFY.
  { ...base, code: "ER_ESI", name: "Employer ESI", componentType: "employer_cost", calc: null, employerCostClass: "employer_esi", isTaxable: false, countsForEsiWage: false, lopApplicable: false, payslipOrder: 45 },
  // Gratuity provision: an accrual, never paid on the slip. 4.81% of basic is the owner's starting value. VERIFY.
  { ...base, code: "GRATUITY", name: "Gratuity provision", componentType: "employer_cost", calc: "pct_of_basic", pctOfBasic: 4.81, employerCostClass: "gratuity_provision", isTaxable: false, countsForEsiWage: false, lopApplicable: false, payslipOrder: 50 },
];
