/**
 * Form 16 document (UAT ux-docs). Rendered by Chromium through @civitasone/render renderPdf, as
 * before, with three changes that make it issuable:
 *   - the deductor name, address, TAN and PAN come from tenant configuration and generation is
 *     refused (FORM16_EMPLOYER_NOT_CONFIGURED) when they are missing - never a placeholder;
 *   - Noto Sans Devanagari is inlined as @font-face, so the PDF embeds the font it uses;
 *   - bilingual (Hindi / English) headings per the Rule 31(1)(a) form.
 * Shared by the single-employee route and the bulk consumer, so both print the same document.
 */
import { GOVERNMENT_DEDUCTOR_CATEGORY, PAN_NOT_REQUIRED, PAN_RE, TAN_RE } from "../deductor-config/domain.js";
import { escapeHtml as esc } from "../../shared/html.js";
import {
  DOC_FONT_STACK, DocumentNotIssuableError, amountInWordsEn, docFontFaceCss, formatDateIst, formatMinorIndian, resolveDocIdentity,
} from "@civitasone/render/official";
import { loadLatestFilings } from "../return-filings/routes.js";
import type { buildForm16 } from "../tax/form16.js";
import { loadLetterhead } from "../letterhead/routes.js";

type Form16Data = Awaited<ReturnType<typeof buildForm16>>;

export interface Form16Deductor { name: string; tan: string; pan: string; address: string | null }


/** A configured value, not an env placeholder such as "<TAN — configure EMPLOYER_TAN>". */
function real(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t || t.startsWith("<") || /configure/i.test(t)) return null;
  return t;
}

/**
 * The deductor printed on Form 16 / 12BA. Sources, first match wins per field: the tenant document
 * identity (tenant-service settings.documentIdentity: orgName, tan, pan, address), the payroll
 * letterhead (organisation name, address), then (single-tenant deployments only) the deploy-level EMPLOYER_* values already present
 * in the built form. Throws DocumentNotIssuableError listing what is missing.
 */
export async function resolveForm16Deductor(tenantId: string, builtForm?: { name: string; tan: string; pan: string }): Promise<Form16Deductor> {
  const ident = await resolveDocIdentity(tenantId);
  // The deploy-level EMPLOYER_* values are one deductor's: honoured only on an explicitly single-tenant
  // deployment (PAYROLL_DEDUCTOR_ENV_FALLBACK=single-tenant), never as a cross-tenant fallback.
  const built = process.env.PAYROLL_DEDUCTOR_ENV_FALLBACK === "single-tenant" ? builtForm : undefined;
  let letterhead: Awaited<ReturnType<typeof loadLetterhead>> = null;
  try { letterhead = await loadLetterhead(tenantId); } catch { letterhead = null; }
  const name = real(ident.orgName) ?? real(letterhead?.orgName) ?? real(built?.name);
  const tan = (real(ident.tan) ?? real(built?.tan))?.toUpperCase() ?? null;
  const pan = (real(ident.pan) ?? real(built?.pan))?.toUpperCase() ?? null;
  const address = real(ident.address) ?? real(letterhead?.address);
  // TAN / PAN formats are the shared ones (deductor-config/domain.ts). A Central / State Government deductor
  // (documentIdentity.deductorCategory "government") may quote PANNOTREQD, as on its Form 24Q / 26Q. The route
  // path has already passed the full deductor validation (placeholders etc.) in buildForm16 -> requireDeductor.
  const government = ident.deductorCategory === GOVERNMENT_DEDUCTOR_CATEGORY;
  const missing: string[] = [];
  if (!name) missing.push("employer name");
  if (!tan || !TAN_RE.test(tan)) missing.push("TAN");
  if (!pan || !(PAN_RE.test(pan) || (government && pan === PAN_NOT_REQUIRED))) missing.push("PAN");
  if (missing.length > 0 || !name || !tan || !pan) {
    throw new DocumentNotIssuableError(
      "FORM16_EMPLOYER_NOT_CONFIGURED",
      `Form 16 cannot be issued: the employer ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not configured. ` +
      "A tenant administrator must set documentIdentity (orgName, tan, pan, address) in the tenant settings.",
      missing,
    );
  }
  return { name, tan, pan, address };
}

const rupees = (n: number) => `₹ ${formatMinorIndian(BigInt(Math.round(n * 100)))}`;

export interface Form16Extras {
  /** Form 24Q quarterly statement receipt numbers (PRN) from the filing records, by quarter. */
  receipts: Map<string, { receiptNo: string; filedOn: string | null }>;
  /** Person responsible for deduction of tax (payroll letterhead DDO / signatory). */
  responsible: { name: string | null; designation: string | null };
  /** Employer serial certificate number (TAN/FY/employee no). */
  certificateNo: string;
}

/** Filing receipts and the responsible person; any read failure leaves the field blank (never invented). */
export async function loadForm16Extras(tenantId: string, fy: string, tan: string, employeeNo: string): Promise<Form16Extras> {
  const receipts = new Map<string, { receiptNo: string; filedOn: string | null }>();
  try {
    for (const [q, f] of await loadLatestFilings(tenantId, "24Q", fy)) {
      const r = f as unknown as { receiptNo?: string; filedOn?: string | null };
      if (r.receiptNo) receipts.set(q, { receiptNo: r.receiptNo, filedOn: r.filedOn ?? null });
    }
  } catch { /* no filing records readable: receipts print blank */ }
  let responsible: { name: string | null; designation: string | null } = { name: null, designation: null };
  try {
    const lh = await loadLetterhead(tenantId);
    responsible = { name: lh?.ddoName ?? null, designation: lh?.signatoryTitle ?? null };
  } catch { /* hand-completed */ }
  return { receipts, responsible, certificateNo: `${tan}/${fy}/${employeeNo}` };
}

/** Form 16 (Part A + Part B) as HTML for the PDF renderer. */
export function renderForm16Html(f: Form16Data, deductor?: Form16Deductor, extras?: Form16Extras): string {
  const a = f.form16PartA, b = f.form16PartB;
  const d = deductor ?? { ...a.deductor, address: null };
  const [startYear] = f.fy.split("-");
  const row = (label: string, val: number, bold = false) =>
    `<tr><td>${bold ? `<strong>${label}</strong>` : label}</td><td class="amount">${bold ? `<strong>${rupees(val)}</strong>` : rupees(val)}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Form 16 — FY ${esc(f.fy)}</title>
<style>
${docFontFaceCss()}
body{font-family:${DOC_FONT_STACK};max-width:800px;margin:0 auto;padding:24px;font-size:13px}
h1{text-align:center;font-size:16px;margin:0} .sub{text-align:center;margin:2px 0} h2{font-size:14px;margin-top:20px}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #333;padding:6px 8px} .amount{text-align:right}
.meta td{border:none;padding:2px 8px}
</style></head><body>
<h1>प्ररूप सं. 16 / FORM No. 16</h1>
<p class="sub">[See rule 31(1)(a)]</p>
<p class="sub"><strong>आय-कर अधिनियम, 1961 की धारा 203 के अधीन वेतन से स्रोत पर कर कटौती का प्रमाणपत्र</strong></p>
<p class="sub"><strong>Form 16 — Certificate under Section 203 of the Income-tax Act, 1961 for tax deducted at source on salary</strong></p>
<table class="meta">
<tr><td><strong>Financial Year:</strong> ${esc(f.fy)}</td><td><strong>Assessment Year:</strong> ${esc(f.assessmentYear)}</td></tr>
${extras ? `<tr><td colspan="2"><strong>Certificate No.:</strong> ${esc(extras.certificateNo)}</td></tr>` : ""}
<tr><td colspan="2"><strong>Period with the employer:</strong> 01 Apr ${esc(startYear ?? "")} to 31 Mar ${esc(String(Number(startYear ?? 0) + 1))}</td></tr>
</table>
<h2>भाग क / Part A — Deductor &amp; Deductee, TDS Deposited</h2>
<table>
<tr><td>Name and address of the employer (deductor)</td><td>${esc(d.name)}${d.address ? `<br/>${esc(d.address)}` : ""}</td></tr>
<tr><td>TAN of the deductor</td><td>${esc(d.tan)}</td></tr>
<tr><td>PAN of the deductor</td><td>${esc(d.pan)}</td></tr>
<tr><td>Name of the employee (deductee)</td><td>${esc(a.deductee.name || f.employeeId)}</td></tr>
<tr><td>PAN of the employee</td><td>${esc(a.deductee.pan || "PANNOTAVBL")}</td></tr>
</table>
<table>
<tr><th>Quarter</th><th>Receipt No. of quarterly statement (Form 24Q)</th><th class="amount">TDS Deposited</th></tr>
${(["Q1", "Q2", "Q3", "Q4"] as const).map((q, i) => `<tr><td>${q} (${["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"][i]})</td><td>${esc(extras?.receipts.get(q)?.receiptNo ?? "")}</td><td class="amount">${rupees(a.quarterlyTds[q])}</td></tr>`).join("\n")}
${a.preGoLiveTds > 0 ? `<tr><td colspan="2">Before go-live here (approved opening YTD)</td><td class="amount">${rupees(a.preGoLiveTds)}</td></tr>` : ""}
<tr><td colspan="2"><strong>Total</strong></td><td class="amount"><strong>${rupees(a.totalTdsDeposited)}</strong></td></tr>
</table>
<h2>भाग ख / Part B — Details of Salary Paid and Tax Deducted (${esc(b.regime)} regime)</h2>
<table>
${row("Gross Salary", b.grossSalary)}
${(b.prevEmployers ?? []).map((p) => row(`Previous employer (Form 12B, s.192(2)): ${esc(p.name)}${p.tan ? ` (${esc(p.tan)})` : ""} -- salary`, p.salary) + row(`Previous employer TDS: ${esc(p.name)}`, p.tds)).join("")}
${row("Standard Deduction (Sec 16)", b.standardDeduction)}
${row("HRA Exemption (Sec 10(13A))", b.hraExempt)}
${row("Deduction 80C", b.section80c)}
${row("Deduction 80D", b.section80d)}
${row("Other Chapter VI-A", b.otherDeductions)}
${row("Total Taxable Income", b.taxableIncome, true)}
${row("Tax on Income", b.taxOnIncome)}
${row("Rebate u/s 87A", b.rebate87A)}
${row("Surcharge", b.surcharge)}
${row("Health &amp; Education Cess (4%)", b.cess)}
${row("Total Tax Liability", b.totalTaxLiability, true)}
${row("Total TDS Deducted", b.totalTdsDeducted, true)}
${b.balanceTaxPayable > 0 ? row("Balance Tax Payable", b.balanceTaxPayable, true) : row("Refund Due", b.refundDue, true)}
</table>
<h2>सत्यापन / Verification</h2>
${(() => {
  const ded = BigInt(Math.round(b.totalTdsDeducted * 100)), dep = BigInt(Math.round(a.totalTdsDeposited * 100));
  const who = extras?.responsible.name ? esc(extras.responsible.name) : "______________________";
  const cap = extras?.responsible.designation ? esc(extras.responsible.designation) : "______________________";
  return `<p>I, ${who}, working in the capacity of ${cap}, do hereby certify that a sum of ${rupees(b.totalTdsDeducted)} [${esc(amountInWordsEn(ded))}] has been deducted and a sum of ${rupees(a.totalTdsDeposited)} [${esc(amountInWordsEn(dep))}] has been deposited to the credit of the Central Government. I further certify that the information given above is true, complete and correct and is based on the books of account, documents, TDS statements, TDS deposited and other available records.</p>
<table class="meta"><tr><td><strong>Place:</strong> ______________</td><td style="text-align:right">______________________________<br/>(Signature of the person responsible for deduction of tax)</td></tr>
<tr><td><strong>Date:</strong> ${esc(formatDateIst(new Date()))}</td><td style="text-align:right"><strong>Full Name:</strong> ${who}<br/><strong>Designation:</strong> ${cap}</td></tr></table>`;
})()}
<p style="font-size:11px;color:#666;margin-top:24px">${esc(a.note)} Verify against TRACES before filing.</p>
</body></html>`;
}
