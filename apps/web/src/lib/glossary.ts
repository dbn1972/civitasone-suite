/**
 * Plain-language glossary for CivitasOne gov-ERP terms.
 * One short sentence per term, written for a clerk with no training.
 * Used by HelpTip "?" tooltips and the /help pages so the wording is consistent
 * everywhere a specialist term appears.
 */
export const GLOSSARY: Record<string, string> = {
  // Finance
  Sanction: "An official approval to spend a fixed amount of money for a stated purpose.",
  GL: "General Ledger — the master record of every money transaction, kept in balance.",
  "General Ledger": "The master record of every money transaction, kept in balance.",
  "Journal entry": "A single accounting record with matching debit and credit amounts.",
  Voucher: "A document that records a payment or receipt before it is posted to accounts.",
  UC: "Utilisation Certificate — proof that grant or scheme money was spent correctly.",
  "Utilisation Certificate": "Proof that grant or scheme money was spent correctly.",
  Advance: "Money paid out before work or a bill is complete, to be adjusted later.",
  Budget: "The money set aside for a purpose in a financial year.",
  "Trial balance": "A check that total debits equal total credits across all accounts.",
  Depreciation: "The yearly reduction in an asset's value as it ages.",
  PFMS: "Public Financial Management System — the government's central payment platform.",
  TDS: "Tax Deducted at Source — tax held back from a payment and sent to the tax department.",

  // Procurement
  Indent: "A request to buy goods or services, raised before a purchase order.",
  GRN: "Goods Received Note — the check done when a delivery arrives against an order.",
  RFQ: "Request for Quotation — asking suppliers to send their prices.",
  Tender: "A formal, competitive process to choose a supplier for larger purchases.",
  PO: "Purchase Order — the official order sent to a supplier to buy something.",
  Empanelment: "Adding a vendor to your approved list so they can be used for purchases.",
  EMD: "Earnest Money Deposit — a refundable amount a bidder pays to take part in a tender.",
  "Bank guarantee": "A bank's promise to pay if a supplier fails to meet their commitment.",
  "Reverse auction": "A live bidding event where suppliers compete by lowering their price.",

  // HR / Payroll
  APAR: "Annual Performance Appraisal Report — the yearly review of an employee.",
  GPF: "General Provident Fund — a savings fund for government employees.",
  NPS: "National Pension System — a retirement savings scheme.",
  LOP: "Loss of Pay — a day with no salary, usually for unapproved absence.",
  Gratuity: "A one-time payment to an employee on retirement or leaving service.",
  "Pay matrix": "The 7th Pay Commission table that sets salary by grade and level.",
  Deputation: "Temporarily sending an employee to work in another office or organisation.",
  Regularisation: "Correcting a missing or wrong attendance entry, with approval.",

  // Grants / Projects
  Grantee: "The person or organisation that receives a grant.",
  Disbursement: "Releasing money to the person or office that should receive it.",
  Installment: "One part of a grant or payment released in stages.",
  Milestone: "A key checkpoint in a project that must be completed on time.",
  DPR: "Detailed Project Report — the full plan and cost estimate for a project.",
  WBS: "Work Breakdown Structure — a project split into phases, stages and tasks.",
  Beneficiary: "The person or group who receives the benefit of a scheme or grant.",

  // Citizen / Legal / Estab
  RTI: "Right to Information — a citizen's request to see official records, answered within 30 days.",
  Grievance: "A complaint from a citizen that must be looked into and resolved.",
  "Court order": "A direction from a court that the office must comply with.",
  Hearing: "A scheduled court date for a case.",
  eOffice: "The paperless file system for moving notes and approvals between desks.",
  "Note sheet": "The running notes and approvals attached to an official file.",
  Dak: "Incoming post or correspondence received by the office.",

  // Platform / Admin (kept simple, mostly hidden from clerks)
  Tenant: "Your office or organisation's own private workspace in the system.",
  Module: "A part of the system you can turn on or off, like Finance or HR.",
  Role: "A set of permissions that decides what a person is allowed to do.",
  MFA: "Multi-Factor Authentication — a second check (like an app code) when signing in.",
  SSO: "Single Sign-On — logging in once to reach all the parts you're allowed to use.",
  "Maker-checker": "One person submits, a second person approves — to prevent mistakes and fraud.",
  "Break-glass": "Emergency access granted for a short time, fully recorded, when something urgent breaks.",
  "LGD code": "Local Government Directory code — the official ID for a state, district, block or village.",
};

/** Look up a term's plain definition (case-insensitive on the key). */
export function explain(term: string): string | undefined {
  if (GLOSSARY[term]) return GLOSSARY[term];
  const lower = term.toLowerCase();
  const key = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === lower);
  return key ? GLOSSARY[key] : undefined;
}
