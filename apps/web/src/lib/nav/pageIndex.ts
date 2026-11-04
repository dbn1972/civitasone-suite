/**
 * UAT-P3 (UX shell, NAV-01 / S-01): the client-side page index behind global
 * search. It always answers, even when record search (gateway /v1/search) is
 * down: every sidebar page plus the deeper screens officers ask for by their
 * government names, with the usual abbreviations (DDO, JV, GRN, HoA, UC,
 * APAR...) and Hindi names as keywords.
 *
 * Entries are filtered with the same module + role gates as the sidebar
 * (navModel.isNavItemVisible), so search never offers a page the user cannot
 * open. Display labels are next-intl keys: appNav.item.<id> (sidebar pages)
 * and appNav.page.<id> (extra pages), English `label` as the fallback.
 */
import { NAV_GROUPS, isNavItemVisible, type NavAccess } from "./navModel";
import { FINANCE_ROLES, HR_ROLES } from "@/lib/auth/workRoles";
import { HR_TILE_ROLE_OVERRIDES } from "@/lib/auth/hrTileAccess";

export type PageEntry = {
  id: string;
  /** "item": a sidebar entry (appNav.item.<id>); "page": an extra screen (appNav.page.<id>). */
  kind: "item" | "page";
  href: string;
  label: string;
  groupId: string;
  groupLabel: string;
  keywords: readonly string[];
  moduleKey: string | null;
  rolesAllowed?: readonly string[];
  failClosed?: boolean;
};

/** Abbreviations, synonyms and Hindi names per sidebar item id. */
const ITEM_KEYWORDS: Record<string, readonly string[]> = {
  dashboard: ["home", "command center", "डैशबोर्ड", "मुखपृष्ठ"],
  setup: ["onboarding", "setup", "शुरुआत"],
  help: ["help", "support", "how to", "सहायता"],
  myLeave: ["leave", "apply leave", "leave application", "casual leave", "earned leave", "CL", "EL", "छुट्टी", "अवकाश", "छुट्टी आवेदन"],
  myPayslips: ["payslip", "pay slip", "salary slip", "salary", "वेतन पर्ची", "वेतन"],
  myAttendance: ["attendance", "check in", "check-in", "punch", "उपस्थिति", "हाजिरी"],
  myTaxDeclaration: ["tax declaration", "investment declaration", "80C", "income tax", "TDS", "आयकर", "कर घोषणा"],
  myProfile: ["profile", "service book", "service record", "प्रोफ़ाइल", "सेवा पुस्तिका"],
  finance: ["accounts", "finance", "वित्त", "लेखा"],
  hr: ["HR", "HRMS", "human resources", "personnel", "मानव संसाधन", "कार्मिक"],
  hrEmployees: ["employee", "staff", "employee master", "कर्मचारी"],
  hrLeaveApprovals: ["leave approval", "sanction leave", "leave sanction", "छुट्टी स्वीकृति", "छुट्टी अनुमोदन"],
  hrPayrollRuns: ["payroll", "salary run", "pay bill", "वेतन", "वेतन बिल"],
  hrSalarySlips: ["salary register", "payslips", "वेतन पर्चियाँ"],
  hrDdos: ["DDO", "DDOs", "drawing and disbursing officer", "drawing officer", "आहरण", "संवितरण", "आहरण एवं संवितरण अधिकारी"],
  revenue: ["revenue", "property tax", "tax collection", "राजस्व", "कर"],
  revenueAssessees: ["assessee", "taxpayer", "property owner", "करदाता"],
  revenueAssessments: ["assessment", "tax assessment", "कर निर्धारण"],
  revenueBills: ["demand", "demand notice", "tax bill", "माँग", "माँग बिल"],
  revenueReceipts: ["receipt", "collection", "challan", "रसीद"],
  revenueWaivers: ["waiver", "rebate", "remission", "छूट"],
  revenueTradeLicences: ["trade licence", "trade license", "licence", "व्यापार लाइसेंस"],
  billing: ["billing", "invoice", "बिलिंग"],
  billingInvoices: ["invoice", "tax invoice", "बीजक", "चालान"],
  billingPayments: ["payment received", "payments", "भुगतान"],
  billingSubscriptions: ["subscription", "सदस्यता"],
  billingGstn: ["GST", "GSTN", "GSTR", "GSTR-1", "GST return", "जीएसटी"],
  procurement: ["purchase", "procurement", "खरीद", "क्रय"],
  contracts: ["contract", "agreement", "अनुबंध"],
  projects: ["project", "works", "परियोजना"],
  grants: ["grant", "grant-in-aid", "अनुदान"],
  establishment: ["establishment", "eOffice", "file", "स्थापना", "फ़ाइल"],
  documents: ["document", "DMS", "दस्तावेज़"],
  assets: ["asset", "asset register", "dead stock", "संपत्ति"],
  fleet: ["vehicle", "fleet", "log book", "वाहन"],
  stock: ["stock", "store", "inventory", "भंडार"],
  meeting: ["meeting", "committee", "बैठक"],
  meetingList: ["meetings", "minutes", "agenda", "बैठकें", "कार्यवृत्त"],
  meetingNew: ["new meeting", "convene", "schedule meeting", "बैठक बुलाएँ"],
  meetingAdmin: ["meeting settings", "committee master", "बैठक सेटिंग"],
  learningCatalogue: ["training", "course", "प्रशिक्षण"],
  myLearning: ["my courses", "my training", "मेरा प्रशिक्षण"],
  trainingCalendar: ["training calendar", "प्रशिक्षण कैलेंडर"],
  competencies: ["competency", "skills", "दक्षता"],
  assessments: ["assessment", "test", "मूल्यांकन"],
  verifyCertificate: ["certificate", "verify", "प्रमाणपत्र"],
  municipal: ["municipal", "ULB", "नगरपालिका"],
  crm: ["CRM", "citizen relationship", "नागरिक संबंध"],
  helpdesk: ["ticket", "helpdesk", "सहायता डेस्क"],
  serviceCatalogue: ["service catalogue", "services", "सेवा सूची"],
  citizen: ["citizen", "grievance", "RTS", "नागरिक", "शिकायत"],
  designer: ["service designer", "form designer", "सेवा डिज़ाइनर"],
  workflow: ["workflow", "my tasks", "file movement", "कार्यप्रवाह"],
  visitor: ["visitor", "gate pass", "आगंतुक"],
  court: ["court", "court case", "hearing", "न्यायालय"],
  inspection: ["inspection", "CAPA", "निरीक्षण"],
  telephony: ["call centre", "telephony", "टेलीफ़ोनी"],
  locations: ["location", "office location", "स्थान"],
  mapViewer: ["map", "GIS", "मानचित्र"],
  mapMonitoring: ["map monitoring", "GIS monitoring", "मानचित्र निगरानी"],
  audit: ["audit", "audit para", "लेखापरीक्षा"],
  legal: ["legal", "case", "law", "विधि"],
  ai: ["AI", "copilot", "एआई"],
  field: ["field", "field ops", "क्षेत्रीय"],
  loyalty: ["loyalty", "लॉयल्टी"],
  catalogue: ["catalogue", "product", "rate", "सूची"],
  cdp: ["CDP", "customer data"],
  journeys: ["journey", "यात्रा"],
  recommendations: ["recommendation", "सुझाव"],
  reports: ["report", "MIS", "रिपोर्ट"],
  knowledge: ["knowledge", "article", "ज्ञान"],
  policies: ["policy", "SOP", "नीति"],
  faq: ["FAQ", "questions", "सामान्य प्रश्न"],
  assistant: ["assistant", "ask", "सहायक"],
  notifications: ["notification", "alerts", "सूचना"],
  identity: ["identity", "users", "पहचान"],
  tenant: ["tenant", "office", "कार्यालय"],
  administration: ["admin", "users", "roles", "प्रशासन"],
  tenantAdmin: ["tenant admin", "office settings", "कार्यालय प्रशासन"],
  change: ["change", "release", "परिवर्तन"],
};

const HR = "hrms";

/** Screens below the sidebar level that officers look for by name. */
const EXTRA_PAGES: PageEntry[] = [
  { id: "approvals", kind: "page", href: "/approvals", label: "My approvals", groupId: "overview", groupLabel: "Overview",
    keywords: ["approvals", "pending", "inbox", "approve", "अनुमोदन", "लंबित"], moduleKey: null },
  { id: "jvNew", kind: "page", href: "/finance/accounting/vouchers/new", label: "New journal voucher (JV)", groupId: "finance", groupLabel: "Finance",
    keywords: ["JV", "journal voucher", "journal entry", "voucher", "जर्नल वाउचर", "वाउचर"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "jvApprovals", kind: "page", href: "/finance/accounting/journal-approvals", label: "Journal voucher approvals", groupId: "finance", groupLabel: "Finance",
    keywords: ["JV", "JV approval", "journal approval", "checker", "वाउचर अनुमोदन"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "generalLedger", kind: "page", href: "/finance/accounting/general-ledger", label: "General ledger", groupId: "finance", groupLabel: "Finance",
    keywords: ["GL", "ledger", "general ledger", "खाता बही"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "headsOfAccount", kind: "page", href: "/finance/chart-of-accounts", label: "Heads of account", groupId: "finance", groupLabel: "Finance",
    keywords: ["HoA", "head of account", "chart of accounts", "major head", "minor head", "object head", "लेखा शीर्ष"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "budgetAllocation", kind: "page", href: "/finance/budget/allocation", label: "Budget allocation", groupId: "finance", groupLabel: "Finance",
    keywords: ["allotment", "BE", "budget estimate", "बजट आवंटन"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "budgetMonitoring", kind: "page", href: "/finance/budget/monitoring", label: "Budget monitoring", groupId: "finance", groupLabel: "Finance",
    keywords: ["budget position", "budget balance", "expenditure against budget", "बजट निगरानी"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "sanctions", kind: "page", href: "/finance/budget/sanctions", label: "Expenditure sanctions", groupId: "finance", groupLabel: "Finance",
    keywords: ["sanction", "sanction order", "स्वीकृति", "स्वीकृति आदेश"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "bills", kind: "page", href: "/finance/expenditure/bills", label: "Bills", groupId: "finance", groupLabel: "Finance",
    keywords: ["bill", "claim", "TR", "बिल"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "utilisationCertificates", kind: "page", href: "/finance/expenditure/utilization-certificates", label: "Utilisation certificates (UC)", groupId: "finance", groupLabel: "Finance",
    keywords: ["UC", "utilisation certificate", "utilization certificate", "GFR 12-A", "उपयोगिता प्रमाणपत्र"], moduleKey: "finance", rolesAllowed: FINANCE_ROLES },
  { id: "indents", kind: "page", href: "/procurement/indents", label: "Indents", groupId: "operations", groupLabel: "Operations",
    keywords: ["indent", "requisition", "माँग पत्र"], moduleKey: "procurement" },
  { id: "purchaseOrders", kind: "page", href: "/procurement/orders", label: "Purchase orders (PO)", groupId: "operations", groupLabel: "Operations",
    keywords: ["PO", "purchase order", "supply order", "क्रय आदेश"], moduleKey: "procurement" },
  { id: "grn", kind: "page", href: "/procurement/grn", label: "Goods receipt notes (GRN)", groupId: "operations", groupLabel: "Operations",
    keywords: ["GRN", "goods receipt", "goods received", "MRN", "माल प्राप्ति"], moduleKey: "procurement" },
  { id: "tenders", kind: "page", href: "/procurement/tenders", label: "Tenders", groupId: "operations", groupLabel: "Operations",
    keywords: ["tender", "bid", "NIT", "निविदा"], moduleKey: "procurement" },
  { id: "eofficeFiles", kind: "page", href: "/estab/files", label: "eOffice files", groupId: "operations", groupLabel: "Operations",
    keywords: ["file", "note sheet", "noting", "eOffice", "फ़ाइल", "नोटशीट"], moduleKey: "establishment" },
  { id: "apar", kind: "page", href: "/hr/apar", label: "APAR (annual performance appraisal)", groupId: "hrPayroll", groupLabel: "HR & Payroll",
    keywords: ["APAR", "ACR", "appraisal", "annual performance appraisal report", "वार्षिक कार्य-निष्पादन मूल्यांकन"], moduleKey: HR, rolesAllowed: HR_TILE_ROLE_OVERRIDES["/hr/apar"] },
  { id: "leaveBalance", kind: "page", href: "/hr/leave/balance", label: "Leave balance", groupId: "selfService", groupLabel: "Self-service",
    keywords: ["leave balance", "leave account", "शेष छुट्टी"], moduleKey: HR, rolesAllowed: HR_ROLES },
  { id: "leaveHistory", kind: "page", href: "/hr/leave/history", label: "Leave history", groupId: "selfService", groupLabel: "Self-service",
    keywords: ["leave history", "my leave applications", "छुट्टी इतिहास"], moduleKey: HR, rolesAllowed: HR_ROLES },
];

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s&-])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
}

/** Every searchable page: sidebar items (with keywords) + EXTRA_PAGES. */
export const PAGE_INDEX: readonly PageEntry[] = [
  ...NAV_GROUPS.flatMap((g) =>
    g.items.map<PageEntry>((i) => ({
      id: i.id, kind: "item", href: i.href, label: i.label, groupId: g.id, groupLabel: titleCase(g.label),
      keywords: ITEM_KEYWORDS[i.id] ?? [], moduleKey: i.moduleKey, rolesAllowed: i.rolesAllowed, failClosed: i.failClosed,
    })),
  ),
  ...EXTRA_PAGES,
];

/** Lower-case, NFKC, punctuation to spaces (keeps letters, combining marks such as Devanagari matras, digits and "/"). */
export function normaliseQuery(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}/\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function scoreText(q: string, tokens: string[], text: string): number {
  const c = normaliseQuery(text);
  if (!c) return 0;
  if (c === q) return 100;
  if (c.startsWith(q)) return 80;
  const words = c.split(" ");
  if (words.some((w) => w.startsWith(q))) return 60;
  if (tokens.length > 1 && tokens.every((tk) => words.some((w) => w.startsWith(tk)))) return 55;
  if (q.length >= 3 && c.includes(q)) return 40;
  return 0;
}

export type PageHit = { entry: PageEntry; label: string; score: number };

/**
 * Matching pages for a query, best first. `labelFor` returns the label in the
 * current language (the translated label is matched as well as the English
 * one and the keywords). Only pages the user can open are returned.
 */
export function searchPages(
  query: string,
  access: NavAccess,
  labelFor: (e: PageEntry) => string = (e) => e.label,
  limit = 8,
): PageHit[] {
  const q = normaliseQuery(query);
  if (q.length < 2) return [];
  const tokens = q.split(" ");
  const hits: PageHit[] = [];
  const seen = new Set<string>();
  for (const entry of PAGE_INDEX) {
    if (seen.has(entry.href) || !isNavItemVisible(entry, access)) continue;
    const label = labelFor(entry);
    const labelScore = Math.max(scoreText(q, tokens, label), scoreText(q, tokens, entry.label));
    const kwScore = entry.keywords.reduce((m, k) => Math.max(m, scoreText(q, tokens, k)), 0);
    // A label hit ranks just above the same-strength keyword hit.
    const score = Math.max(labelScore > 0 ? labelScore + 5 : 0, kwScore);
    if (score > 0) {
      seen.add(entry.href);
      hits.push({ entry, label, score });
    }
  }
  hits.sort((a, b) => b.score - a.score || a.label.length - b.label.length);
  return hits.slice(0, limit);
}
