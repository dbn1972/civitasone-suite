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
  DBT: "Direct Benefit Transfer — paying scheme money straight into a beneficiary's bank account.",
  IRN: "Invoice Reference Number — the unique ID a tax invoice gets when registered with the government portal.",
  UTR: "Unique Transaction Reference — the number that identifies a bank transfer so you can trace it.",
  NEFT: "National Electronic Funds Transfer — a common way to move money between banks.",
  RTGS: "Real Time Gross Settlement — a fast bank transfer used for larger amounts.",
  BE: "Budget Estimate — the money planned for the year before any revision.",
  RE: "Revised Estimate — the updated budget figure after part of the year has passed.",
  "3-way match": "Checking the order, the delivery, and the bill agree before a payment is made.",
  "Form 16A": "A certificate showing tax that was deducted from a payment, given to the payee.",
  Voted: "Spending that needs Parliament's or the Assembly's approval through a vote.",
  Charged: "Spending fixed by law that does not need a separate vote.",

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
  CPC: "Central Pay Commission — the body whose recommendations set government pay scales.",
  Deputation: "Temporarily sending an employee to work in another office or organisation.",
  Regularisation: "Correcting a missing or wrong attendance entry, with approval.",
  PPO: "Pension Payment Order — the document that authorises a retired employee's pension.",
  DDO: "Drawing and Disbursing Officer — the official who draws and pays out government money.",
  "DDO Code": "The official code that identifies a Drawing and Disbursing Officer.",
  ESI: "Employees' State Insurance — a health and benefit scheme for eligible employees.",
  PT: "Professional Tax — a small state tax deducted from salaries.",
  KRA: "Key Result Area — the main thing a person is expected to deliver in their role.",
  "TA-DA": "Travelling Allowance and Daily Allowance — money to cover official travel and trip costs.",

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
  Dak: "Incoming and outgoing post or correspondence handled by the office.",
  DAK: "Incoming and outgoing post or correspondence handled by the office.",
  MOM: "Minutes of Meeting — the official written record of what a meeting decided.",

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

/**
 * True when a plain-language definition exists for the term. Never throws — safe
 * to use in coverage checks and to decide whether to surface a HelpTip. (R2.3)
 */
export function hasDefinition(term: string): boolean {
  return explain(term) !== undefined;
}
