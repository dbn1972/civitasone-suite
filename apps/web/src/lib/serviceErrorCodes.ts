/**
 * Service error code -> plain-language message (apps/web/docs/ERROR-MESSAGES.md).
 *
 * The services answer a failed request with { code, message }. The message is
 * developer text and is never shown. The code is looked up here:
 *
 *   1. SERVICE_CODE_MESSAGES: a hand-written message for one code (en + hi).
 *   2. CODE_FAMILIES: a message for every code that follows a naming family
 *      (*_NOT_FOUND, DUPLICATE_*, SELF_*, *_EXCEEDED, ...). Some families reuse the
 *      status copy of a kind (notFound, conflict, validation, server, timeout,
 *      unauthenticated) because that copy is already the right message for every
 *      code in the family.
 *
 * errorCatalogue.ts consults DOMAIN_CODE_MESSAGES first, then this module, then the
 * HTTP status. Every code that services/* can return is covered by 1 or 2; the test
 * serviceErrorCodes.test.ts scans services/* and fails when a new code matches
 * neither.
 */
import type { ErrorLocale, ErrorStatusKind, StandardAction } from "./errorCatalogue";

export type CodeCopy = { what: string; next: string };
export type ServiceCodeMessage = { en: CodeCopy; hi: CodeCopy; actions?: StandardAction[] };

const RECORD = { en: "record", hi: "रिकॉर्ड" };

const msg = (en: CodeCopy, hi: CodeCopy, actions: StandardAction[] = ["back", "help"]): ServiceCodeMessage => ({ en, hi, actions });

const NO_EMPLOYEE_LINK_MESSAGE = msg(
  {
    what: "Your sign-in is not linked to an employee record.",
    next: "Ask your HR administrator to link your user account to your employee record, then sign in again.",
  },
  {
    what: "आपका साइन-इन किसी कर्मचारी रिकॉर्ड से जुड़ा नहीं है।",
    next: "अपने एचआर प्रशासक से अपना उपयोगकर्ता खाता अपने कर्मचारी रिकॉर्ड से जुड़वाएँ, फिर दोबारा साइन इन करें।",
  },
);

const NO_CHANGE_MESSAGE = msg(
  { what: "Nothing was changed.", next: "Change at least one field, then save." },
  { what: "कुछ भी नहीं बदला गया।", next: "कम से कम एक फ़ील्ड बदलें, फिर सहेजें।" },
  ["help"],
);

/** One hand-written message per code. The code itself is never shown. */
export const SERVICE_CODE_MESSAGES: Record<string, ServiceCodeMessage> = {
  // workflow-service: a task with no role may only be acted on by its assignee or a workflow admin.
  TASK_NOT_AUTHORIZED: msg(
    {
      what: "This task isn't assigned to you.",
      next: "Only the officer it is assigned to, or a workflow administrator, can act on it. Ask your workflow administrator to reassign it if needed.",
    },
    {
      what: "यह कार्य आपको नहीं सौंपा गया है।",
      next: "इस पर केवल वही अधिकारी कार्रवाई कर सकते हैं जिन्हें यह सौंपा गया है, या वर्कफ़्लो प्रशासक। ज़रूरत हो तो वर्कफ़्लो प्रशासक से इसे दोबारा सौंपने को कहें।",
    },
  ),
  // procurement-service: a PO above Rs 1,000 must cite an approved budget sanction.
  SANCTION_REF_REQUIRED: msg(
    {
      what: "A purchase order above ₹1,000 needs an approved budget sanction.",
      next: "Choose the sanction reference in the Sanction field, then submit again.",
    },
    {
      what: "₹1,000 से अधिक के क्रय आदेश के लिए स्वीकृत बजट संस्वीकृति आवश्यक है।",
      next: "संस्वीकृति फ़ील्ड में संस्वीकृति संदर्भ चुनें, फिर दोबारा जमा करें।",
    },
    ["retry", "help"],
  ),
  // finance-service: the commitment or posting would go over the available budget of the head.
  BUDGET_EXCEEDED: msg(
    {
      what: "This amount is more than the budget still available under this head.",
      next: "Reduce the amount, or ask your budget officer for a re-appropriation, then try again.",
    },
    {
      what: "यह राशि इस शीर्ष में शेष बजट से अधिक है।",
      next: "राशि कम करें, या अपने बजट अधिकारी से पुनर्विनियोजन करवाएँ, फिर प्रयास करें।",
    },
  ),
  // payroll-service: a run holding Rs 0-basic slips is not approved unless each one is excluded with a reason.
  ZERO_BASIC_SLIPS: msg(
    {
      what: "Some payslips in this run have no basic pay, because the basic pay is missing from the employee records.",
      next: "Correct the basic pay in the HR records and run payroll again, or exclude each of these employees with a reason when you approve.",
    },
    {
      what: "इस रन की कुछ वेतन पर्चियों में मूल वेतन नहीं है, क्योंकि कर्मचारी रिकॉर्ड में मूल वेतन दर्ज नहीं है।",
      next: "एचआर रिकॉर्ड में मूल वेतन ठीक करके वेतन दोबारा चलाएँ, या अनुमोदन करते समय इन कर्मचारियों को कारण सहित अलग करें।",
    },
  ),
  // hrms-service: the signed-in user has no employee record (self-service pages).
  NO_EMPLOYEE_RECORD: NO_EMPLOYEE_LINK_MESSAGE,
  NO_EMPLOYEE_LINK: NO_EMPLOYEE_LINK_MESSAGE,
  // hrms-service bulk import: the employee number is already used.
  EMPLOYEE_NO_EXISTS: msg(
    {
      what: "An employee with this employee number already exists.",
      next: "Use a different employee number, or open the existing employee instead.",
    },
    {
      what: "इस कर्मचारी क्रमांक का कर्मचारी पहले से मौजूद है।",
      next: "कोई दूसरा कर्मचारी क्रमांक इस्तेमाल करें, या मौजूदा कर्मचारी को खोलें।",
    },
  ),
  // identity-service: the last active tenant administrator cannot be removed or demoted.
  LAST_TENANT_ADMIN: msg(
    { what: "This is the only active administrator for your office.", next: "Make another user an administrator first, then try again." },
    { what: "यह आपके कार्यालय का एकमात्र सक्रिय प्रशासक है।", next: "पहले किसी दूसरे उपयोगकर्ता को प्रशासक बनाएँ, फिर प्रयास करें।" },
  ),
  // payroll-service (GPF / CPF): a withdrawal or advance larger than the balance.
  INSUFFICIENT_BALANCE: msg(
    { what: "The amount is more than the balance available in the account.", next: "Enter an amount within the available balance, then try again." },
    { what: "राशि खाते में उपलब्ध शेष से अधिक है।", next: "उपलब्ध शेष के भीतर की राशि दर्ज करें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  // procurement-service: a requisition type with no approval chain cannot be submitted.
  NO_APPROVAL_CHAIN: msg(
    { what: "No approval chain is set up for this request.", next: "Ask your administrator to set up the approval chain, then submit again. What you entered is kept." },
    { what: "इस अनुरोध के लिए कोई अनुमोदन श्रृंखला तय नहीं है।", next: "अपने प्रशासक से अनुमोदन श्रृंखला तय करवाएँ, फिर दोबारा जमा करें। आपकी भरी हुई जानकारी सुरक्षित है।" },
  ),
  // hrms-service attendance: today is a gazetted holiday.
  HOLIDAY: msg(
    { what: "Today is a gazetted holiday, so attendance can't be marked.", next: "No action is needed. Mark attendance on the next working day." },
    { what: "आज राजपत्रित अवकाश है, इसलिए उपस्थिति दर्ज नहीं की जा सकती।", next: "कोई कार्रवाई आवश्यक नहीं है। अगले कार्य दिवस पर उपस्थिति दर्ज करें।" },
  ),
  // Many services: a PATCH with no fields.
  NO_CHANGES: NO_CHANGE_MESSAGE,
  NO_CHANGE: NO_CHANGE_MESSAGE,
  // finance-service bills: the deduction lines are more than the bill gross.
  DEDUCTIONS_EXCEED_GROSS: msg(
    { what: "The deductions add up to more than the gross amount of the bill.", next: "Reduce the deductions or correct the gross amount, then save again." },
    { what: "कटौतियों का योग बिल की सकल राशि से अधिक है।", next: "कटौतियाँ कम करें या सकल राशि ठीक करें, फिर दोबारा सहेजें।" },
    ["retry", "help"],
  ),
  // payroll-service: no slip in the run is payable (held / exception slips are never paid).
  NO_PAYABLE_SLIPS: msg(
    { what: "No payslip in this run can be paid yet.", next: "Resolve the held or exception payslips first, then try again." },
    { what: "इस रन की कोई भी वेतन पर्ची अभी भुगतान योग्य नहीं है।", next: "पहले रोकी गई या अपवाद वाली वेतन पर्चियों का समाधान करें, फिर प्रयास करें।" },
  ),
  // payroll-service: a pay group with a draft / processing run cannot be changed.
  PAY_GROUP_HAS_ACTIVE_RUN: msg(
    { what: "This pay group has a payroll run that is still in draft or processing.", next: "Finish or cancel that run first, then try again." },
    { what: "इस वेतन समूह का एक वेतन रन अभी ड्राफ़्ट या प्रसंस्करण में है।", next: "पहले उस रन को पूरा या रद्द करें, फिर प्रयास करें।" },
  ),
  // pension: every checklist item must be done before a PPO is issued.
  CHECKLIST_INCOMPLETE: msg(
    { what: "The checklist is not complete yet.", next: "Complete every checklist item, then try again." },
    { what: "जाँच-सूची अभी पूरी नहीं हुई है।", next: "जाँच-सूची का हर बिंदु पूरा करें, फिर प्रयास करें।" },
  ),
  // finance-service: postings must go to a leaf head, not a group head.
  GL_HEAD_NOT_LEAF: msg(
    { what: "This account head has sub-heads, so entries can't be posted to it.", next: "Choose one of its sub-heads instead." },
    { what: "इस लेखा शीर्ष के उप-शीर्ष हैं, इसलिए इसमें प्रविष्टि पोस्ट नहीं की जा सकती।", next: "इसके बजाय इसका कोई उप-शीर्ष चुनें।" },
    ["retry", "help"],
  ),
  // admin-service: a module the tenant is not entitled to.
  MODULE_NOT_ENTITLED: msg(
    { what: "This module is not part of your office's subscription.", next: "Ask your platform administrator to add it, then try again." },
    { what: "यह मॉड्यूल आपके कार्यालय की सदस्यता में शामिल नहीं है।", next: "अपने प्लेटफ़ॉर्म प्रशासक से इसे जुड़वाएँ, फिर प्रयास करें।" },
  ),
  // API keys without the needed scope (integration screens).
  OUT_OF_SCOPE: msg(
    { what: "The API key used here isn't allowed to do this.", next: "Ask your platform administrator for a key with the right permission." },
    { what: "यहाँ इस्तेमाल की गई API कुंजी को यह कार्य करने की अनुमति नहीं है।", next: "अपने प्लेटफ़ॉर्म प्रशासक से उपयुक्त अनुमति वाली कुंजी माँगें।" },
  ),
  // Uploads still being virus-checked.
  SCAN_PENDING: msg(
    { what: "The file is still being checked for viruses.", next: "Wait a minute, then try again." },
    { what: "फ़ाइल की वायरस जाँच अभी चल रही है।", next: "एक मिनट रुकें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  // Outbound URL blocked by the server-side request-forgery guard (integration settings).
  SSRF_BLOCKED: msg(
    { what: "This web address can't be used.", next: "Enter a public https address from the provider, then try again." },
    { what: "यह वेब पता इस्तेमाल नहीं किया जा सकता।", next: "प्रदाता का कोई सार्वजनिक https पता दर्ज करें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  // Recruitment: an interviewer must score before seeing the scores of others.
  SCORE_FIRST: msg(
    { what: "Submit your own score first.", next: "The other panel members' scores are shown after you submit yours." },
    { what: "पहले अपने अंक दर्ज करें।", next: "आपके अंक दर्ज करने के बाद पैनल के अन्य सदस्यों के अंक दिखाई देंगे।" },
  ),
  // identity-service: the email address on the account has not been verified yet.
  EMAIL_NOT_VERIFIED: msg(
    { what: "This email address hasn't been verified yet.", next: "Open the verification link sent to the email address, then try again." },
    { what: "यह ईमेल पता अभी सत्यापित नहीं हुआ है।", next: "ईमेल पर भेजा गया सत्यापन लिंक खोलें, फिर प्रयास करें।" },
  ),
  // payroll-service: the arrears warning recorded on a run.
  ARREARS_OVERDRAWN: msg(
    { what: "Some past months were paid above the pay now due.", next: "Review those months; the difference is reported only and is not recovered automatically." },
    { what: "कुछ पिछले महीनों में अब देय वेतन से अधिक भुगतान हुआ है।", next: "उन महीनों की समीक्षा करें; अंतर केवल दर्शाया गया है, यह अपने-आप वसूल नहीं होता।" },
  ),
  PREREQUISITES_NOT_MET: msg(
    { what: "The earlier steps for this are not complete yet.", next: "Complete the earlier steps first, then try again." },
    { what: "इसके पिछले चरण अभी पूरे नहीं हुए हैं।", next: "पहले पिछले चरण पूरे करें, फिर प्रयास करें।" },
  ),
  LOCKED: msg(
    { what: "This record is locked and can't be changed.", next: "Ask your administrator if a correction is needed." },
    { what: "यह रिकॉर्ड लॉक है और बदला नहीं जा सकता।", next: "सुधार की ज़रूरत हो तो अपने प्रशासक से पूछें।" },
  ),
  PERMANENT_RECORD: msg(
    { what: "This is a permanent record and can't be deleted.", next: "Ask your administrator if a correction is needed." },
    { what: "यह स्थायी रिकॉर्ड है और हटाया नहीं जा सकता।", next: "सुधार की ज़रूरत हो तो अपने प्रशासक से पूछें।" },
  ),
  FEE_NOT_PAID: msg(
    { what: "The fee for this application hasn't been paid yet.", next: "Record or collect the fee first, then try again." },
    { what: "इस आवेदन का शुल्क अभी जमा नहीं हुआ है।", next: "पहले शुल्क दर्ज करें या प्राप्त करें, फिर प्रयास करें।" },
  ),
  FEE_EXEMPT: msg(
    { what: "This application is exempt from the fee.", next: "No payment is needed. Continue to the next step." },
    { what: "इस आवेदन पर शुल्क से छूट है।", next: "भुगतान की आवश्यकता नहीं है। अगले चरण पर जाएँ।" },
  ),
  NEGATIVE_TOTAL: msg(
    { what: "The total can't be less than zero.", next: "Check the amounts and try again." },
    { what: "कुल राशि शून्य से कम नहीं हो सकती।", next: "राशियाँ जाँचें और फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  OVER_RECEIPT: msg(
    { what: "The quantity received is more than the quantity ordered.", next: "Enter a quantity within the order, then try again." },
    { what: "प्राप्त मात्रा आदेशित मात्रा से अधिक है।", next: "आदेश के भीतर की मात्रा दर्ज करें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  OVER_ACCEPT: msg(
    { what: "The quantity accepted is more than the quantity received.", next: "Enter a quantity within what was received, then try again." },
    { what: "स्वीकृत मात्रा प्राप्त मात्रा से अधिक है।", next: "प्राप्त मात्रा के भीतर की मात्रा दर्ज करें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  ODOMETER_REGRESSION: msg(
    { what: "The odometer reading is lower than the last one recorded.", next: "Check the reading and enter it again." },
    { what: "ओडोमीटर रीडिंग पिछली दर्ज रीडिंग से कम है।", next: "रीडिंग जाँचकर फिर से दर्ज करें।" },
    ["retry", "help"],
  ),
  OFFICERS_NOT_DISTINCT: msg(
    { what: "The same officer has been chosen for more than one role.", next: "Choose a different officer for each role, then try again." },
    { what: "एक ही अधिकारी को एक से अधिक भूमिकाओं के लिए चुना गया है।", next: "हर भूमिका के लिए अलग अधिकारी चुनें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  ALLOCATION_NOT_100: msg(
    { what: "The split doesn't add up to 100%.", next: "Adjust the percentages so they add up to 100%, then save." },
    { what: "विभाजन का योग 100% नहीं है।", next: "प्रतिशत इस तरह बदलें कि योग 100% हो, फिर सहेजें।" },
    ["retry", "help"],
  ),
  INVOICE_SERIES_EXHAUSTED: msg(
    { what: "All numbers in this invoice series have been used.", next: "Ask your finance administrator to open a new invoice series." },
    { what: "इस बीजक शृंखला की सभी संख्याएँ इस्तेमाल हो चुकी हैं।", next: "अपने वित्त प्रशासक से नई बीजक शृंखला खुलवाएँ।" },
  ),
  // citizen-service domain-pack activation: the pack produced no draft forms (shown on the install steps log).
  NO_DRAFTS_IMPORTED: msg(
    {
      what: "The domain pack didn't add any draft forms, so this step couldn't finish.",
      next: "Check that the pack has forms for the modules your office uses, then run the step again. Ask your platform administrator if it keeps happening.",
    },
    {
      what: "डोमेन पैक से कोई ड्राफ़्ट फ़ॉर्म नहीं जुड़ा, इसलिए यह चरण पूरा नहीं हो सका।",
      next: "जाँचें कि पैक में आपके कार्यालय के मॉड्यूलों के फ़ॉर्म हैं, फिर चरण दोबारा चलाएँ। समस्या बनी रहे तो अपने प्लेटफ़ॉर्म प्रशासक से पूछें।",
    },
    ["retry", "help"],
  ),
  // finance-service: a financial year can be closed only when all its periods are closed.
  FY_OPEN_PERIODS: msg(
    { what: "Some accounting periods of this financial year are still open.", next: "Close every period of the year first, then close the year." },
    { what: "इस वित्तीय वर्ष की कुछ लेखा अवधियाँ अभी खुली हैं।", next: "पहले वर्ष की हर अवधि बंद करें, फिर वर्ष बंद करें।" },
  ),
  // finance-service: a control account is posted only through its subsidiary ledger.
  CONTROL_ACCOUNT: msg(
    { what: "This is a control account, so entries can't be posted to it directly.", next: "Post the entry through its subsidiary ledger (for example the vendor or employee ledger) instead." },
    { what: "यह नियंत्रण खाता है, इसलिए इसमें सीधे प्रविष्टि पोस्ट नहीं की जा सकती।", next: "प्रविष्टि इसके सहायक खाता-बही (जैसे विक्रेता या कर्मचारी खाता-बही) से पोस्ट करें।" },
    ["retry", "help"],
  ),
  // identity-service: the device does not meet the security policy of the office.
  DEVICE_NON_COMPLIANT: msg(
    { what: "This device doesn't meet your office's security rules.", next: "Use an office-approved device, or ask your IT administrator to check this one." },
    { what: "यह उपकरण आपके कार्यालय के सुरक्षा नियमों के अनुरूप नहीं है।", next: "कार्यालय द्वारा स्वीकृत उपकरण इस्तेमाल करें, या अपने आईटी प्रशासक से इसकी जाँच करवाएँ।" },
  ),
  // ai-service: the assistant refused a message that tries to give it instructions.
  PROMPT_INJECTION_BLOCKED: msg(
    { what: "The assistant can't accept this message.", next: "Ask your question in your own words, without instructions to the system, then send it again." },
    { what: "सहायक यह संदेश स्वीकार नहीं कर सकता।", next: "अपना प्रश्न अपने शब्दों में, सिस्टम के लिए निर्देशों के बिना पूछें, फिर दोबारा भेजें।" },
    ["retry", "help"],
  ),
  // library: a book with copies still issued cannot be withdrawn.
  COPIES_STILL_OUT: msg(
    { what: "Some copies of this book are still issued to readers.", next: "Get those copies returned first, then try again." },
    { what: "इस पुस्तक की कुछ प्रतियाँ अभी पाठकों को जारी हैं।", next: "पहले वे प्रतियाँ वापस लें, फिर प्रयास करें।" },
  ),
  // asset-service insurance: the claim is larger than the sum insured.
  CLAIM_EXCEEDS_COVERAGE: msg(
    { what: "The claim amount is more than the sum insured under this policy.", next: "Enter an amount within the sum insured, then file the claim again." },
    { what: "दावे की राशि इस पॉलिसी की बीमित राशि से अधिक है।", next: "बीमित राशि के भीतर की राशि दर्ज करें, फिर दावा दोबारा दर्ज करें।" },
    ["retry", "help"],
  ),
  CALL_TASK: msg(
    { what: "This step is done by a phone call, not on this screen.", next: "Make the call, then record the outcome on the task." },
    { what: "यह चरण फ़ोन कॉल से पूरा होता है, इस स्क्रीन से नहीं।", next: "कॉल करें, फिर कार्य पर परिणाम दर्ज करें।" },
  ),
};

type Family = {
  id: string;
  pattern: RegExp;
  /** The family reuses the status copy of this kind: it is already the right message. */
  kind?: ErrorStatusKind;
  message?: ServiceCodeMessage;
  /** Use the validation copy instead when the failure carries field-level messages. */
  deferToFieldErrors?: boolean;
  /** Object noun when the caller gave none. */
  object?: { en: string; hi: string };
};

/**
 * Naming families, in priority order (first match wins). Built from the codes in
 * services/* (about 1,400); see serviceErrorCodes.test.ts.
 */
export const CODE_FAMILIES: Family[] = [
  {
    id: "unknownReference",
    pattern: /^UNKNOWN_|_UNKNOWN$|_UNKNOWN_|^UNMAPPED_/,
    message: msg(
      { what: "Something you chose is no longer available.", next: "Refresh the page, choose again, then try again." },
      { what: "आपके द्वारा चुनी गई कोई चीज़ अब उपलब्ध नहीं है।", next: "पेज रीफ़्रेश करें, फिर से चुनें और दोबारा प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  { id: "notFound", pattern: /NOT_FOUND|^NO_SUCH_/, kind: "notFound", object: RECORD },
  {
    id: "separationOfDuties",
    pattern: /^SELF_|_SELF_|^SOD_|SEGREGATION_OF_DUTIES|PAYER_IS_PASSER|MAKER_CHECKER|MAKER_CANNOT|INITIATOR_EQUALS|SAME_ACTOR|REPEAT_ACTOR|_OWN_/,
    message: msg(
      { what: "You can't act on something you created or requested yourself.", next: "Another officer needs to do this." },
      { what: "आप अपने द्वारा बनाए या माँगे गए कार्य पर स्वयं कार्रवाई नहीं कर सकते।", next: "यह कार्य किसी दूसरे अधिकारी को करना होगा।" },
    ),
  },
  {
    id: "permission",
    pattern:
      /FORBIDDEN|_DENIED$|DENIED_|NOT_AUTHORI[SZ]ED|UNAUTHORI[SZ]ED|^NOT_(ASSIGNEE|ASSIGNED|REQUESTER|CASE_OWNER|STAGE_OWNER|DELEGATOR|YOUR_[A-Z_]+|A_MEMBER|A_PANELIST|ON_PANEL|AN_OPERATOR|PERMITTED|OWNER)$|READONLY|READ_ONLY|EDITION_RESTRICTED|FEATURE_AUTHORITY|INSUFFICIENT_CLEARANCE|ROLE_REQUIRED|REQUIRES_ROLE|ROLE_NOT_HELD|OPERATOR_REQUIRES_APPROVAL|NOT_PRODUCTION|NOT_HR_OFFICER|NOT_REVEALABLE/,
    message: msg(
      {
        what: "This action isn't available to you.",
        next: "Only the officer it is assigned to, or someone with the right role, can do it. Ask your administrator if you need access.",
      },
      {
        what: "यह कार्रवाई आपके लिए उपलब्ध नहीं है।",
        next: "इसे केवल वही अधिकारी कर सकते हैं जिन्हें यह सौंपा गया है, या जिनके पास उपयुक्त भूमिका है। पहुँच चाहिए तो अपने प्रशासक से कहें।",
      },
    ),
  },
  { id: "duplicate", pattern: /^DUPLICATE|_DUPLICATE|_EXISTS$|ALREADY_EXISTS|_TAKEN$|^NAME_TAKEN$|_ASSIGNED$|DOUBLE_BOOKED|_CLASH$/ },
  { id: "session", pattern: /^UNAUTHENTICATED$|SESSION_ENDED|SESSION_EXPIRED|UPSTREAM_UNAUTHENTICATED|TOKEN_EXPIRED|INVALID_TOKEN/, kind: "unauthenticated" },
  {
    id: "wait",
    pattern: /COOLDOWN|RECENTLY_REQUESTED/,
    message: msg(
      { what: "This was done very recently.", next: "Wait a few minutes before trying again." },
      { what: "यह कार्य अभी हाल ही में किया गया है।", next: "दोबारा प्रयास करने से पहले कुछ मिनट रुकें।" },
    ),
  },
  {
    // An overlapping range (PT slabs, licence-fee periods, memberships, windows) is a rule about the values,
    // not a concurrent edit: it must not read as "changed by someone else".
    id: "overlap",
    pattern: /OVERLAP/,
    message: msg(
      { what: "This clashes with an existing entry.", next: "Change the dates or the range so they don't clash with it, then try again." },
      { what: "यह किसी मौजूदा प्रविष्टि से टकराता है।", next: "तिथियाँ या सीमा इस तरह बदलें कि वे आपस में न टकराएँ, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  { id: "conflict", pattern: /^STALE|_STALE$|_STALE_|_CHANGED$|CHANGED_|_CONFLICT$|^CONFLICT|VERSION_MISMATCH|SUPERSEDED|CONCURRENT/, kind: "conflict", object: RECORD },
  {
    id: "inProgress",
    pattern: /_IN_PROGRESS$|_PENDING$|_PENDING_|^PENDING_|_IN_FLIGHT$|_RUNNING$|_QUEUED$|STILL_OUT/,
    object: RECORD,
    message: msg(
      { what: "Another action on this {object} is still being processed.", next: "Wait a few minutes, refresh the page, then try again." },
      { what: "इस {object} पर एक दूसरी कार्रवाई अभी चल रही है।", next: "कुछ मिनट रुकें, पेज रीफ़्रेश करें, फिर दोबारा प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "expired",
    pattern: /EXPIRED|_REPLAYED$|_REUSED$|^OTP_|NO_CHALLENGE|_USED$/,
    message: msg(
      { what: "This link or code has expired or has already been used.", next: "Start this step again to get a new one." },
      { what: "यह लिंक या कोड समाप्त हो चुका है या पहले ही इस्तेमाल हो चुका है।", next: "नया पाने के लिए यह चरण फिर से शुरू करें।" },
    ),
  },
  {
    id: "virusScan",
    pattern: /INFECTED|MALWARE|^SCAN_/,
    message: msg(
      { what: "The file didn't pass the virus check, so it wasn't accepted.", next: "Upload a clean copy of the file." },
      { what: "फ़ाइल वायरस जाँच में सफल नहीं हुई, इसलिए स्वीकार नहीं की गई।", next: "फ़ाइल की कोई सुरक्षित प्रति अपलोड करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "inactive",
    pattern:
      /INACTIVE|_DISABLED$|^DISABLED|NOT_CONFIGURED|_UNCONFIGURED$|NOT_ENABLED|NOT_PROVISIONED|NOT_IMPLEMENTED|DEACTIVATED|SUSPENDED|BLACKLISTED|SANDBOX_ONLY|UNSUPPORTED_PROVIDER|NOT_AVAILABLE|NOT_YET_AVAILABLE|TEST_SEND_UNSUPPORTED|NOT_BUILT|NOT_READY|NOT_TRUSTED|NOT_ENTITLED|NOT_EMPANELLED/,
    message: msg(
      { what: "This isn't available, because it has been switched off, deactivated or not set up.", next: "Choose an active one, or ask your administrator to switch it on." },
      { what: "यह उपलब्ध नहीं है, क्योंकि इसे बंद, निष्क्रिय या अभी तय नहीं किया गया है।", next: "कोई सक्रिय विकल्प चुनें, या अपने प्रशासक से इसे चालू करवाएँ।" },
    ),
  },
  {
    id: "nothingToDo",
    pattern: /^NOTHING_|_NOTHING_|NO_COPIES/,
    message: msg(
      { what: "There is nothing to process for this right now.", next: "Check your selection or the period, then try again." },
      { what: "अभी इसके लिए संसाधित करने को कुछ नहीं है।", next: "अपना चयन या अवधि जाँचें, फिर प्रयास करें।" },
    ),
  },
  {
    id: "limit",
    pattern: /EXCEED|OUT_OF_RANGE|^OVER_|OVERCLAIM|OVERPAYMENT|CEILING|_MIN_|_MAX_|_LIMIT|LIMIT_|^TOO_|_TOO_|^MAX_|_MAX$|INSUFFICIENT_|BELOW_|_ABOVE_|CAP_REACHED|AT_CAPACITY|SMALL_COHORT|_BOUND$|NON_POSITIVE|_ZERO_|^ZERO_|EXHAUSTED/,
    message: msg(
      { what: "This goes over an allowed limit.", next: "Reduce the amount or number and try again. Ask your administrator if the limit needs to change." },
      { what: "यह अनुमत सीमा से अधिक है।", next: "राशि या संख्या कम करके फिर प्रयास करें। सीमा बदलनी हो तो अपने प्रशासक से पूछें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "date",
    pattern: /_IN_PAST$|_IN_FUTURE$|^OUTSIDE_|^DATE_|_DATE_|_DATE$|_PASSED$|DEADLINE|OUTSIDE_WINDOW|BAD_WINDOW|_WINDOW$|BACKDATE|_BEFORE_|_AFTER_|NOT_LATER|_RANGE$|BAD_RANGE|WITHIN_MONTH|_DATES?_|NOT_LAPSED|NOT_ELAPSED|ON_FUTURE|OUT_OF_ORDER/,
    message: msg(
      { what: "This date isn't allowed for this action.", next: "Check the date against the rules shown on the form, then try again." },
      { what: "इस कार्रवाई के लिए यह तिथि मान्य नहीं है।", next: "फ़ॉर्म पर दिए नियमों के अनुसार तिथि जाँचें, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "stage",
    pattern:
      /INVALID_STATE|_STATE$|STATE_|TRANSITION|WRONG_STAGE|STAGE_|^NOT_[A-Z_]+$|_NOT_[A-Z_]+$|^ALREADY_|_ALREADY_|_CLOSED$|^CLOSED|_LOCKED$|LOCKED_|FROZEN|FINALI[SZ]ED|TERMINAL|IMMUTABLE|^CANCELL?ED$|_CANCELL?ED$|WITHDRAWN|ARCHIVED|RETIRED|^EXECUTED$|^APPROVED$|REVOKED|^CANNOT_|_CANNOT_|NOT_ALLOWED|NOT_EDITABLE|_RECORDED$|_RESOLVED$|_ENDED$|_ACTIVE$|^USE_|_PURGED$|REJECTED|PROTECTED|LEGAL_HOLD|^HAS_|_HAS_|ATTESTED|_EXITED$|IN_USE|_WITHHELD$|BLOCKED|_OPEN$|_ONLY$|_USES_|_AT_CURRENT_RATE$|_ON_HOLD$|HANDED_OFF/,
    object: RECORD,
    message: msg(
      { what: "This {object} is not at a stage that allows this action.", next: "Refresh the page to see its current status, then choose an action that is available." },
      { what: "यह {object} ऐसे चरण में नहीं है जहाँ यह कार्रवाई की जा सके।", next: "इसकी वर्तमान स्थिति देखने के लिए पेज रीफ़्रेश करें, फिर उपलब्ध कार्रवाई चुनें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "setupMissing",
    pattern: /^NO_|_NOT_SET$|_NO_[A-Z]+|AMBIGUOUS_|UNLINKED|^MISSING_|CONFIG_INCOMPLETE|INCOMPLETE|NOT_ON_FILE|NOT_EMPLOYEE|NOT_IN_HR|NOT_IN_TENANT|NOT_IN_TARGET|_AND_CELL$|USE_VERSIONS/,
    message: msg(
      { what: "This can't be done yet, because something it needs hasn't been set up.", next: "Ask your administrator to complete the setup, then try again." },
      { what: "यह अभी नहीं हो सकता, क्योंकि इसके लिए ज़रूरी कोई व्यवस्था अभी तय नहीं की गई है।", next: "अपने प्रशासक से व्यवस्था पूरी करवाएँ, फिर प्रयास करें।" },
    ),
  },
  {
    id: "required",
    pattern: /_REQUIRED$|REQUIRED_|NEEDS_|_MISSING$|^EMPTY_|_EMPTY$|^EMPTY$|WITHOUT_|_REQUIRES_|NOT_UPLOADED/,
    deferToFieldErrors: true,
    message: msg(
      { what: "Some required information is missing.", next: "Fill in the missing details, then try again." },
      { what: "कुछ आवश्यक जानकारी नहीं भरी गई है।", next: "छूटी हुई जानकारी भरें, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  { id: "timeout", pattern: /TIMEOUT|TIMED_OUT/, kind: "timeout" },
  {
    id: "upstream",
    pattern: /UNAVAILABLE|UPSTREAM|GATEWAY|CIRCUIT|EXTERNAL_|_FAILED$|^FAILED|_FAILURE$|_ERROR$|^INTERNAL|DOWNSTREAM|PROVIDER_|_UNREACHABLE$|UNVERIFIABLE|UNVERIFIED|UNSIGNED|SIGNATURE|UNRESOLVABLE|NOT_INVOCABLE/,
    kind: "server",
  },
  {
    id: "mismatch",
    pattern: /MISMATCH|DOES_NOT_MATCH|NOT_AN_EXACT|NOT_MATCH|UNMATCHABLE|_NOT_EQUAL|UNBALANCED|_DIFFERS|_NOT_100$/,
    message: msg(
      { what: "Some details don't match.", next: "Check the values against the source document, then try again." },
      { what: "कुछ विवरण आपस में मेल नहीं खाते।", next: "मूल दस्तावेज़ से मान जाँचें, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "validation",
    pattern:
      /INVALID|MALFORMED|^BAD_|_BAD_|UNSUPPORTED|UNPROCESSABLE|PAYLOAD|SCHEMA|^NOT_AN?_|^SAME_|_SAME_|EMPTY_PATCH|CYCLE|CIRCULAR|UNINDEXABLE|UNCLASSIFIABLE|UNREADABLE|_VIOLATION$|VALIDATION|_RULE_|_FORMAT|^REQUEST_|^IDEMPOTENCY|_NOT_SUPPORTED|_EQUAL$|WRONG_|ILLEGAL|_UNCHANGED$|NOT_ACCEPTED|_REGRESSION$|RESERVED/,
    kind: "validation",
  },
];

export type ServiceCodeResolution =
  | { source: "explicit"; id: string; message: ServiceCodeMessage }
  | { source: "family"; id: string; message: ServiceCodeMessage; object?: { en: string; hi: string } }
  | { source: "family"; id: string; kind: ErrorStatusKind; object?: { en: string; hi: string } }
  | { source: "family"; id: "duplicate"; duplicate: true };

/** True for a string that looks like a service code (UPPER_SNAKE, at least two parts). */
export function isServiceCode(code: unknown): code is string {
  return typeof code === "string" && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(code);
}

/** How a service code is explained: its own message, a family message, a family that reuses the copy of a kind, or null. */
export function resolveServiceCode(code: string | null | undefined, opts?: { hasFieldErrors?: boolean }): ServiceCodeResolution | null {
  if (!code) return null;
  if (Object.prototype.hasOwnProperty.call(SERVICE_CODE_MESSAGES, code)) {
    return { source: "explicit", id: code, message: SERVICE_CODE_MESSAGES[code] };
  }
  for (const f of CODE_FAMILIES) {
    if (!f.pattern.test(code)) continue;
    if (f.id === "duplicate") return { source: "family", id: "duplicate", duplicate: true };
    if (f.deferToFieldErrors && opts?.hasFieldErrors) return { source: "family", id: f.id, kind: "validation" };
    if (f.kind) return { source: "family", id: f.id, kind: f.kind, object: f.object };
    if (f.message) return { source: "family", id: f.id, message: f.message, object: f.object };
  }
  return null;
}

/** The copy for a locale. */
export function codeCopy(m: ServiceCodeMessage, locale: ErrorLocale): CodeCopy {
  return m[locale];
}
