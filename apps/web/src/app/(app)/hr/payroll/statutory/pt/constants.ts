/**
 * GAP-PAYROLL-STATUTORY-PT-02: the sentinel paise value PtSlabForm sends for
 * an open-ended ("no upper bound") slab. Shared by the form (which writes
 * it) and the page (which must recognise it and print "No upper bound"
 * instead of formatting it as ₹9,99,99,99,999.99 via the generic "amount"
 * cellType). Do NOT change this value without backend agreement -- the PT
 * calculation engine may compare stored slab_to_minor values against it.
 */
export const PT_NO_UPPER_BOUND_MINOR = 999_999_999_999;
