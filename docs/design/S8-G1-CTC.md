# S8-G1: the private CTC salary profile (`ctc_contract`)

Section 8 gap G1, go-live core. Stacked on G2 (#2489) and the statutory seams (#2487). Flag **`S8_CTC_PROFILE_ENABLED`**
(payroll-service AND hrms-service env; only the exact string `true` enables it; default off). The profile is also opt-in by
data: no `ctc_contract` pay profile, no change. Migrations: payroll `0168`, hrms `0269`.

## Flow

1. HRMS `POST /v1/hrms/employees/:id/pay-profile` with `payProfile: ctc_contract` and `ctcTerms`
   `{ annualFixedMinor, annualVariableTargetMinor?, templateLineageId, epfWagePolicy: ceiling|actual, esiOptOut, gratuityProvisionOn, overrides: [{code, monthlyMinor}] }`
   (digit strings, paise). Same maker-checker, month-start effective date, locked-period rule and audit as every pay profile.
   Flag off: terms are refused (`CTC_PROFILE_DISABLED`) and a terms-less request behaves as before.
2. The payroll-input feed carries the approved terms in `payProfile.ctc` (flag on only).
3. The run resolves, once per template lineage, the **locked** template version in force for the month through
   `resolveTemplateForMonth` (G2), never a structure id, then `planEmployeePay` expands it (`modules/ctc/model.ts`).
4. The slip is booked line by line (BASIC, HRA, SPECIAL, ...) through computeSlip's existing `earningsOverride`; PF, ESI,
   PT, LWF, TDS and the deduction caps are the unchanged shared tail.

## The solver (`expandCtc`, pure)

`M = round(annual / 12)` to the rupee. Lines: `pct_of_ctc`, `pct_of_basic`, `fixed`, one `balancing`. Employer costs are inside
CTC (carved out of the balancing line) or on top (paid in addition). Employer PF and ESI are derived from the effective-dated
statutory config with the same formulas as computeSlip: PF = 12% of min(PF wage, ceiling) (or the uncapped wage on
`epfWagePolicy: actual`); ESI = employer rate on the whole gross when gross is at or under the ceiling. The ESI circularity is
solved by evaluating ESI off first and, if the gross is then at or under the ceiling, re-solving with ESI on (the balancing
figure shrinks to pay for it). The balancing line is the largest whole-rupee value that fits (binary search; total cost is
non-decreasing in it), so at most Rs 1-2 stays unallocated and is reported (`unallocatedMinor`), never hidden. A negative
balancing figure is a hard error (`CTC_NEGATIVE_BALANCING`). A template with no employer PF/ESI line pays them on top, with a
warning. Gratuity provision is `pct_of_basic` on the template line (the 4.81% is the owner's starting value in a template, not
code), never paid on the slip.

Per-employee override: `overrides` replaces single lines (not the balancing line, not statutory-derived costs); the balancing
line absorbs the difference. Switching `gratuityProvisionOn` off drops those lines for the employee.

## Proration (owner decision 3)

By calendar days, reusing `lop-math` `proratedPayMinor`. Days outside service (before joining / after leaving) reach every
line; leave/attendance LOP reaches only lines with `lop_applicable`. PF, ESI and gratuity are re-priced on the prorated figures
(the PF ceiling applies to wages actually earned, ESI is tested on the prorated gross: both VERIFY). No LOP deduction line.

## Not here (phase 2 / other lanes)

Back-dated revision arrears; CTC statement PDF; preview API and request-form CTC tab; HRMS-to-payroll template-existence check
at request time (payroll fails the employee by name at run time instead); bulk request rule (G6 `registerBulkProfileRule`);
HRA for old-regime tax declarations (`tax/consumer.ts` still returns 0 for ctc_contract); F&F for CTC; run-level "by pay profile"
subtotal; LWF/ESI contribution-period interplay beyond the seams already in #2487; whole-run fault isolation (owner decision Q12).
