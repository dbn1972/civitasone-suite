/**
 * Single source for the statutory REFERENCE values shown on the statutory hub
 * (GAP-PAYROLL-STATUTORY-01 / GAP-PAYROLL-STATUTORY-ESI-05). These are display
 * references only -- the payroll engine reads its own tenant configuration, and
 * none of this feeds a computation. They are labelled "as of <date>" wherever
 * shown because EPFO / ESIC / FinMin circulars revise them.
 *
 * PT and LWF are deliberately NOT here: both are state-specific (PT slabs, LWF
 * fixed rupee amounts per state) and are configured on their own pages.
 */

/** Month the reference values below were last checked against the circulars. */
export const STATUTORY_REFERENCE_AS_OF = "Aug 2026";

/** EPFO wage ceiling, paise (Rs 15,000/month). */
export const PF_WAGE_CEILING_MINOR = 1_500_000;
export const PF_EMPLOYEE_PCT = 12;
export const PF_EMPLOYER_PCT = 12;

/** ESIC wage ceiling, paise (Rs 21,000/month). */
export const ESI_WAGE_CEILING_MINOR = 2_100_000;
export const ESI_EMPLOYEE_PCT = 0.75;
export const ESI_EMPLOYER_PCT = 3.25;

export const NPS_EMPLOYEE_PCT = 10;
export const NPS_EMPLOYER_PCT = 14;

/** PF and ESI contributions are remitted by the 15th of the following month. */
export const PF_ESI_CHALLAN_DUE_DAY = 15;
