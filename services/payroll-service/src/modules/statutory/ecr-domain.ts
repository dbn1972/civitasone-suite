/** EPFO statutory ceiling on pensionable wages (rupees). */
export const EPF_WAGE_CEILING = 15000;

/**
 * EPFO pensionable wage = Basic + DA, capped at the Rs 15,000 ceiling
 * (EPF Scheme para 29 read with the 2014 amendment ceiling).
 * Basic alone under-states the wage for every employee with a DA component
 * and gets the ECR challan rejected (PAY-DEF01).
 */
export function computePensionableWage(basicWages: number, daWages: number): number {
  return Math.min(basicWages + daWages, EPF_WAGE_CEILING);
}
