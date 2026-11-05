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
/** serverSide: the message stays true for a 5xx / 429 / 408 / 401 answer too (otherwise the status copy wins there). */
/** alsoAt401: the message also wins over a 401 (an OTP refused on a public, signed-out page is not "session ended"). */
export type ServiceCodeMessage = { en: CodeCopy; hi: CodeCopy; actions?: StandardAction[]; serverSide?: boolean; alsoAt401?: boolean };

const RECORD = { en: "record", hi: "रिकॉर्ड" };

const msg = (en: CodeCopy, hi: CodeCopy, actions: StandardAction[] = ["back", "help"], serverSide = false): ServiceCodeMessage =>
  serverSide ? { en, hi, actions, serverSide } : { en, hi, actions };

const CIRCUIT_OPEN_MESSAGE = msg(
  { what: "A connected service is not responding right now, so requests to it are paused.", next: "Nothing was sent. Try again in a few minutes." },
  { what: "एक जुड़ी हुई सेवा अभी उत्तर नहीं दे रही है, इसलिए उसे भेजे जाने वाले अनुरोध रोके गए हैं।", next: "कुछ भी नहीं भेजा गया। कुछ मिनट बाद फिर प्रयास करें।" },
  ["retry", "help"],
  true,
);

const RATE_LIMIT_MESSAGE = msg(
  { what: "Too many attempts in a short time.", next: "Wait a minute, then try again." },
  { what: "थोड़े समय में बहुत ज़्यादा प्रयास हो गए हैं।", next: "एक मिनट रुकें, फिर दोबारा प्रयास करें।" },
  ["retry", "help"],
  true,
);

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
      what: "₹1,000 से अधिक के क्रय आदेश के लिए अनुमोदित बजट संस्वीकृति का संदर्भ आवश्यक है।",
      next: "संस्वीकृति फ़ील्ड में संस्वीकृति संदर्भ चुनें, फिर दोबारा जमा करें।",
    },
    ["retry", "help"],
  ),
  // finance-service (budget head commitment) and hrms flexi-benefit (elected amount over the plan budget):
  // the copy names neither, so it is true for both.
  BUDGET_EXCEEDED: msg(
    {
      what: "This amount is more than the budget available for it.",
      next: "Enter a lower amount, or ask the officer who manages this budget whether it can be increased, then try again.",
    },
    {
      what: "यह राशि इसके लिए उपलब्ध बजट से अधिक है।",
      next: "कम राशि दर्ज करें, या इस बजट का प्रबंधन करने वाले अधिकारी से पूछें कि क्या इसे बढ़ाया जा सकता है, फिर प्रयास करें।",
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
      next: "एचआर रिकॉर्ड में मूल वेतन ठीक करके वेतन रन दोबारा चलाएँ, या अनुमोदन करते समय कारण दर्ज करके इन कर्मचारियों को बाहर रखें।",
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
  // hrms (CPF / GPF / NPS withdrawals) and estab consumables (issue above stock): neutral copy for both.
  INSUFFICIENT_BALANCE: msg(
    { what: "There isn't enough available for this.", next: "Enter a smaller amount or quantity, within what is available, then try again." },
    { what: "इसके लिए पर्याप्त शेष उपलब्ध नहीं है।", next: "उपलब्ध शेष के भीतर कम राशि या मात्रा दर्ज करें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  // hrms recruitment (requisition-routes): a requisition with no approval chain cannot be submitted.
  NO_APPROVAL_CHAIN: msg(
    { what: "No approval chain is set up for this request.", next: "Ask your administrator to set up the approval chain, then submit again. What you entered is kept." },
    { what: "इस अनुरोध के लिए कोई अनुमोदन शृंखला तय नहीं है।", next: "अपने प्रशासक से अनुमोदन शृंखला तय करवाएँ, फिर दोबारा जमा करें। आपकी भरी हुई जानकारी सुरक्षित है।" },
  ),
  // hrms-service attendance: today is a gazetted holiday.
  HOLIDAY: msg(
    { what: "Today is a gazetted holiday, so attendance can't be marked.", next: "No action is needed. Mark attendance on the next working day." },
    { what: "आज राजपत्रित अवकाश है, इसलिए उपस्थिति दर्ज नहीं की जा सकती।", next: "कोई कार्रवाई आवश्यक नहीं है। अगले कार्य दिवस पर उपस्थिति दर्ज करें।" },
  ),
  // Many services: a PATCH with no fields.
  NO_CHANGES: NO_CHANGE_MESSAGE,
  NO_CHANGE: NO_CHANGE_MESSAGE,
  // works-service billing: the deduction lines are more than the bill gross.
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
    { what: "The quantity received is more than the quantity still to be received on this order.", next: "Enter a quantity within what is still open on the order, then try again." },
    { what: "प्राप्त मात्रा इस आदेश पर अभी प्राप्त होने वाली शेष मात्रा से अधिक है।", next: "आदेश पर शेष मात्रा के भीतर की मात्रा दर्ज करें, फिर प्रयास करें।" },
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
  // ---- Dedicated messages that stay true whatever the status (marked serverSide) ----
  // billing gstn / finance pfms / citizen ai: the circuit breaker in front of an external service is open (503).
  CIRCUIT_OPEN: CIRCUIT_OPEN_MESSAGE,
  GATEWAY_CIRCUIT_OPEN: CIRCUIT_OPEN_MESSAGE,
  RATE_LIMITED: RATE_LIMIT_MESSAGE,
  TOO_MANY_REQUESTS: RATE_LIMIT_MESSAGE,
  DEVICE_RATE_LIMIT: RATE_LIMIT_MESSAGE,
  OTP_RATE_LIMITED: RATE_LIMIT_MESSAGE,
  // payroll bank-file signing: the signature did not verify against its own key after signing (500).
  SIGNING_SELF_CHECK_FAILED: msg(
    { what: "The signing check failed on our side, so nothing was signed or sent.", next: "Try again in a few minutes. If it keeps happening, contact your support team." },
    { what: "हमारी ओर से हस्ताक्षर जाँच विफल रही, इसलिए कुछ भी हस्ताक्षरित या भेजा नहीं गया।", next: "कुछ मिनट बाद फिर प्रयास करें। समस्या बनी रहे तो अपनी सहायता टीम से संपर्क करें।" },
    ["retry", "help"],
    true,
  ),
  // ---- One-time codes ----
  OTP_INVALID: { ...msg(
    { what: "The code you entered is not correct.", next: "Check the code in the latest message and enter it again." },
    { what: "आपके द्वारा दर्ज किया गया कोड सही नहीं है।", next: "नवीनतम संदेश में आया कोड जाँचें और उसे फिर से दर्ज करें।" },
    ["retry", "help"],
  ), alsoAt401: true },
  OTP_LOCKED: { ...msg(
    { what: "Too many wrong codes were entered, so the code is locked.", next: "Wait a few minutes, then ask for a new code." },
    { what: "कई बार ग़लत कोड दर्ज किया गया, इसलिए कोड लॉक कर दिया गया है।", next: "कुछ मिनट रुकें, फिर नया कोड माँगें।" },
  ), alsoAt401: true },
  OTP_REQUIRED: { ...msg(
    { what: "A one-time code is needed to continue.", next: "Enter the code sent to your registered mobile number or email." },
    { what: "आगे बढ़ने के लिए एक बार उपयोग होने वाला कोड (OTP) आवश्यक है।", next: "अपने पंजीकृत मोबाइल नंबर या ईमेल पर भेजा गया कोड दर्ज करें।" },
    ["retry", "help"],
  ), alsoAt401: true },
  OTP_NOT_ENABLED: { ...msg(
    { what: "Sign-in codes are not switched on for this account.", next: "Ask your administrator to switch on one-time codes for your account." },
    { what: "इस खाते के लिए एक बार उपयोग होने वाले कोड चालू नहीं हैं।", next: "अपने प्रशासक से अपने खाते के लिए OTP चालू करवाएँ।" },
  ), alsoAt401: true },
  // ---- Codes the naming rules would read wrongly ----
  CONFLICT_OF_INTEREST: msg(
    { what: "You have a declared conflict of interest in this matter, so you can't act on it.", next: "Another officer needs to do this. Ask the officer in charge to reassign it." },
    { what: "इस मामले में आपका हितों का टकराव घोषित है, इसलिए आप इस पर कार्रवाई नहीं कर सकते।", next: "यह कार्य किसी दूसरे अधिकारी को करना होगा। प्रभारी अधिकारी से इसे दोबारा सौंपने को कहें।" },
  ),
  SIGNING_CONFIG_CONFLICT: msg(
    { what: "This signing setting doesn't fit with the other bank-file settings.", next: "Check the bank file signing settings, change the format or key, then save again." },
    { what: "यह हस्ताक्षर सेटिंग बैंक फ़ाइल की अन्य सेटिंग से मेल नहीं खाती।", next: "बैंक फ़ाइल हस्ताक्षर सेटिंग जाँचें, प्रारूप या कुंजी बदलें, फिर दोबारा सहेजें।" },
    ["retry", "help"],
  ),
  STATE_CODE_INVALID: msg(
    { what: "The state code is not a valid GST state code.", next: "Enter the 2-digit GST state code (for example 21 for Odisha), then try again." },
    { what: "राज्य कोड मान्य जीएसटी राज्य कोड नहीं है।", next: "2 अंकों का जीएसटी राज्य कोड दर्ज करें (जैसे ओडिशा के लिए 21), फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  AADHAAR_NOT_ACCEPTED: msg(
    { what: "An Aadhaar number can't be used here.", next: "Use another identity document listed on the form." },
    { what: "यहाँ आधार संख्या का उपयोग नहीं किया जा सकता।", next: "फ़ॉर्म में दिया गया कोई दूसरा पहचान दस्तावेज़ उपयोग करें।" },
    ["retry", "help"],
  ),
  ACCOUNT_NOT_ON_FILE: msg(
    { what: "No account is on file for this employee.", next: "Add the account in the employee record first, then try again." },
    { what: "इस कर्मचारी का कोई खाता दर्ज नहीं है।", next: "पहले कर्मचारी रिकॉर्ड में खाता जोड़ें, फिर प्रयास करें।" },
  ),
  FEE_NOT_SET: msg(
    { what: "No fee has been set up for this.", next: "Ask your administrator to set the fee in the fee schedule, then try again." },
    { what: "इसके लिए कोई शुल्क तय नहीं किया गया है।", next: "अपने प्रशासक से शुल्क अनुसूची में शुल्क तय करवाएँ, फिर प्रयास करें।" },
  ),
  ATTACHMENT_NOT_UPLOADED: msg(
    { what: "The attachment hasn't finished uploading.", next: "Upload the file again and wait until it shows as uploaded, then try again." },
    { what: "संलग्नक का अपलोड पूरा नहीं हुआ है।", next: "फ़ाइल फिर से अपलोड करें और अपलोड हो जाने तक प्रतीक्षा करें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  ACTOR_NOT_EMPLOYEE: NO_EMPLOYEE_LINK_MESSAGE,
  FNF_EMPLOYEE_NOT_IN_HR: msg(
    { what: "This employee is not in the HR records, so a full and final settlement can't be worked out.", next: "Check the employee number, or ask HR to add the employee record first." },
    { what: "यह कर्मचारी एचआर रिकॉर्ड में नहीं है, इसलिए पूर्ण एवं अंतिम निपटान की गणना नहीं हो सकती।", next: "कर्मचारी क्रमांक जाँचें, या एचआर से पहले कर्मचारी रिकॉर्ड जुड़वाएँ।" },
  ),
  CTC_PROFILE_NOT_SUPPORTED: msg(
    { what: "This pay profile can't be used for a CTC breakdown.", next: "Choose a pay profile that has CTC components, then try again." },
    { what: "इस वेतन प्रोफ़ाइल से सीटीसी विवरण नहीं बनाया जा सकता।", next: "सीटीसी घटकों वाली कोई वेतन प्रोफ़ाइल चुनें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  PT_GENDER_UNKNOWN: msg(
    { what: "The employee's gender is not recorded, so professional tax can't be worked out.", next: "Record the gender in the employee record, then run payroll again." },
    { what: "कर्मचारी का लिंग दर्ज नहीं है, इसलिए व्यवसाय कर की गणना नहीं हो सकती।", next: "कर्मचारी रिकॉर्ड में लिंग दर्ज करें, फिर वेतन रन दोबारा चलाएँ।" },
  ),
  PT_STATE_UNKNOWN: msg(
    { what: "The employee's work state is not recorded, so professional tax can't be worked out.", next: "Record the work location state in the employee record, then run payroll again." },
    { what: "कर्मचारी के कार्य-राज्य की जानकारी दर्ज नहीं है, इसलिए व्यवसाय कर की गणना नहीं हो सकती।", next: "कर्मचारी रिकॉर्ड में कार्य स्थान का राज्य दर्ज करें, फिर वेतन रन दोबारा चलाएँ।" },
  ),
  SUSPENDED_PAY_WITHHELD: msg(
    { what: "Pay is withheld while this employee is under suspension.", next: "Pay subsistence allowance through the suspension process instead." },
    { what: "निलंबन की अवधि में इस कर्मचारी का वेतन रोका गया है।", next: "इसके बजाय निलंबन प्रक्रिया के माध्यम से जीवन निर्वाह भत्ता दें।" },
  ),
  // payroll-service (fix/uat-p3-payroll-stat): arrears above the review threshold need an acknowledgement on approval.
  ARREARS_REVIEW_REQUIRED: msg(
    { what: "Some employees have large arrears in this run.", next: "Review and acknowledge each one before approving." },
    { what: "इस रन में कुछ कर्मचारियों का बकाया (एरियर) अधिक है।", next: "अनुमोदन से पहले हर एक की समीक्षा करके उसकी पुष्टि करें।" },
  ),
  UNSIGNED_NOT_ALLOWED_IN_PRODUCTION: msg(
    { what: "Unsigned bank files can't be used in production.", next: "Choose a signing method in Bank file signing, then try again." },
    { what: "लाइव प्रणाली में बिना हस्ताक्षर वाली बैंक फ़ाइल का उपयोग नहीं किया जा सकता।", next: "बैंक फ़ाइल हस्ताक्षर में कोई हस्ताक्षर विधि चुनें, फिर प्रयास करें।" },
    ["back", "help"],
  ),
  ROOM_AT_CAPACITY: msg(
    { what: "This room is already full for that time.", next: "Choose another room or a different time, then try again." },
    { what: "उस समय के लिए यह कक्ष पहले से भरा हुआ है।", next: "कोई दूसरा कक्ष या दूसरा समय चुनें, फिर प्रयास करें।" },
    ["retry", "help"],
  ),
  // finance: a cheque or draft older than its validity period.
  INSTRUMENT_STALE: msg(
    { what: "This cheque or draft is past its validity period.", next: "Ask for a fresh instrument, then record that one." },
    { what: "यह चेक या ड्राफ़्ट अपनी वैधता अवधि पार कर चुका है।", next: "नया लिखत माँगें, फिर उसे दर्ज करें।" },
  ),
  MISSING_OTP: { ...msg(
    { what: "A one-time code is needed to continue.", next: "Enter the code sent to your registered mobile number or email." },
    { what: "आगे बढ़ने के लिए एक बार उपयोग होने वाला कोड (OTP) आवश्यक है।", next: "अपने पंजीकृत मोबाइल नंबर या ईमेल पर भेजा गया कोड दर्ज करें।" },
    ["retry", "help"],
  ), alsoAt401: true },
  EMPTY_PATCH: NO_CHANGE_MESSAGE,
  // hrms device trust: an administrator blocked this device (403). A security block: refreshing never helps.
  DEVICE_BLOCKED: msg(
    { what: "This device has been blocked for security reasons.", next: "Contact your administrator." },
    { what: "सुरक्षा कारणों से इस उपकरण को अवरुद्ध कर दिया गया है।", next: "अपने प्रशासक से संपर्क करें।" },
    ["back", "help"],
  ),
  // ai-agent-service: the input was stopped by the safety guardrails (422).
  GUARDRAIL_BLOCKED: msg(
    { what: "The assistant can't help with this request.", next: "Rephrase it, or contact your administrator if you think this is wrong." },
    { what: "सहायक इस अनुरोध में मदद नहीं कर सकता।", next: "इसे दूसरे शब्दों में लिखें, या यदि आपको लगता है कि यह ग़लत है तो अपने प्रशासक से संपर्क करें।" },
    ["retry", "help"],
  ),
  // estab linkage: the initiating officer is not enrolled as an eOffice operator with initiate rights.
  CANNOT_INITIATE: msg(
    { what: "You don't have the eOffice rights to start this file.", next: "Ask your eOffice administrator to enrol you as an operator with initiate rights, or ask an officer who has them." },
    { what: "यह फ़ाइल शुरू करने के लिए आपके पास ई-ऑफ़िस के अधिकार नहीं हैं।", next: "अपने ई-ऑफ़िस प्रशासक से स्वयं को आरंभ करने के अधिकार वाले संचालक के रूप में नामांकित करवाएँ, या ऐसे अधिकार वाले किसी अधिकारी से कहें।" },
  ),
  CALL_TASK: msg(
    { what: "This step is done by a phone call, not on this screen.", next: "Make the call, then record the outcome on the task." },
    { what: "यह चरण फ़ोन कॉल से पूरा होता है, इस स्क्रीन से नहीं।", next: "कॉल करें, फिर कार्य पर परिणाम दर्ज करें।" },
  ),
};

type Family = {
  id: string;
  /** Unambiguous naming rule. Ambiguous names are left to the status copy (the unmapped fallback). */
  pattern: RegExp;
  /** Names that match the pattern but mean something else. */
  except?: RegExp;
  /** The family reuses the status copy of this kind: it is already the right message. */
  kind?: ErrorStatusKind;
  message?: ServiceCodeMessage;
  /** Use the validation copy instead when the failure carries field-level messages. */
  deferToFieldErrors?: boolean;
  /** Object noun when the caller gave none. */
  object?: { en: string; hi: string };
  /** Statuses for which the family does not apply (the status copy is truer there). */
  notForStatus?: number[];
  /** The family applies only to these statuses (a name whose meaning depends on the status). */
  onlyForStatus?: number[];
};

/**
 * Naming families, in priority order (first match wins). They refine a 4xx answer only
 * (resolveHumanError never applies them to 401, 408, 429, 5xx or 504) and only where the
 * name says one thing. A code that matches none of them gets the status copy: an honest
 * generic message is better than a guessed specific one.
 */
export const CODE_FAMILIES: Family[] = [
  // Real edit conflicts only: a version or ETag check failed because someone else saved first.
  {
    id: "versionConflict",
    pattern: /^(?:STALE_[A-Z0-9_]*|[A-Z0-9_]*VERSION_CONFLICT|[A-Z0-9_]*VERSION_MISMATCH|CONCURRENT_[A-Z0-9_]*|[A-Z0-9_]*_CONCURRENT_(EDIT|UPDATE|MODIFICATION)|[A-Z0-9_]*ETAG[A-Z0-9_]*|EDIT_CONFLICT|PRECONDITION_FAILED)$/,
    kind: "concurrentEdit",
    object: RECORD,
  },
  {
    id: "alreadyBooked",
    pattern: /^(?:(BOOKING|ROOM|VEHICLE|SLOT|VENUE|HALL|DRIVER|RESOURCE)_CONFLICT|[A-Z0-9_]*_SLOT_CONFLICT|[A-Z0-9_]*DOUBLE_BOOKED[A-Z0-9_]*|[A-Z0-9_]*_ALREADY_(BOOKED|OCCUPIED|ALLOTTED|RESERVED))$/,
    message: msg(
      { what: "This is already booked or allotted to someone else.", next: "Choose a different one, or a different time, then try again." },
      { what: "यह पहले से किसी और के लिए बुक या आवंटित है।", next: "कोई दूसरा विकल्प या दूसरा समय चुनें, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  { id: "fileTooLarge", pattern: /^(?:(FILE|DOCUMENT|ARTEFACT|ARTIFACT|PROOF|PAYLOAD|UPLOAD|ATTACHMENT|IMAGE|PHOTO|SCAN)_TOO_(LARGE|BIG))$/, kind: "tooLarge" },
  { id: "notFound", pattern: /^(?:[A-Z0-9_]*_NOT_FOUND|NOT_FOUND|NO_SUCH_[A-Z0-9_]*)$/, kind: "notFound", object: RECORD },
  { id: "duplicate", pattern: /^(?:DUPLICATE_[A-Z0-9_]*|[A-Z0-9_]*_DUPLICATE|[A-Z0-9_]*_ALREADY_EXISTS|[A-Z0-9_]*_EXISTS|[A-Z0-9_]*_TAKEN)$/, except: /^(?:[A-Z0-9_]*_NOT_EXISTS|NOT_EXISTS)$/ },
  {
    id: "separationOfDuties",
    pattern: /^(?:SELF_(APPROVAL|DECISION|REVIEW|DISBURSE|VERIFY|VERIFICATION|SIGN|ASSIGN)[A-Z0-9_]*|[A-Z0-9_]*_SELF_APPROVAL[A-Z0-9_]*|SOD_[A-Z0-9_]*|[A-Z0-9_]*SEGREGATION_OF_DUTIES[A-Z0-9_]*|[A-Z0-9_]*MAKER_CHECKER[A-Z0-9_]*|[A-Z0-9_]*MAKER_CANNOT_CHECK[A-Z0-9_]*|[A-Z0-9_]*INITIATOR_EQUALS_APPROVER[A-Z0-9_]*|[A-Z0-9_]*SAME_ACTOR[A-Z0-9_]*|[A-Z0-9_]*REPEAT_ACTOR[A-Z0-9_]*|[A-Z0-9_]*PAYER_IS_PASSER[A-Z0-9_]*)$/,
    except: /^(?:OVERRIDE_VIA_MAKER_CHECKER)$/,
    message: msg(
      { what: "You can't act on something you created or requested yourself.", next: "Another officer needs to do this." },
      { what: "आप अपने द्वारा बनाए या माँगे गए कार्य पर स्वयं कार्रवाई नहीं कर सकते।", next: "यह कार्य किसी दूसरे अधिकारी को करना होगा।" },
    ),
  },
  {
    id: "permission",
    except: /^(?:CONSENT_DENIED)$/,
    pattern: /^(?:[A-Z0-9_]*_FORBIDDEN|FORBIDDEN_[A-Z0-9_]*|[A-Z0-9_]*_DENIED|[A-Z0-9_]*NOT_AUTHORI[SZ]ED[A-Z0-9_]*|[A-Z0-9_]*UNAUTHORI[SZ]ED_[A-Z0-9_]*|NOT_(ASSIGNEE|REQUESTER|CASE_OWNER|STAGE_OWNER|DELEGATOR|OWNER)|NOT_YOUR_[A-Z0-9_]*|[A-Z0-9_]*_ROLE_REQUIRED|[A-Z0-9_]*ROLE_NOT_HELD[A-Z0-9_]*|[A-Z0-9_]*INSUFFICIENT_CLEARANCE[A-Z0-9_]*)$/,
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
  { id: "rateLimited", pattern: /^(?:[A-Z0-9_]*RATE_LIMIT[A-Z0-9_]*|[A-Z0-9_]*TOO_MANY_REQUESTS[A-Z0-9_]*|[A-Z0-9_]*THROTTLED[A-Z0-9_]*)$/, kind: "rateLimited" },
  // The item is no longer waiting for this decision (approved, rejected, closed, or not yet at this step).
  {
    id: "alreadyDecided",
    pattern: /^(?:[A-Z0-9_]*_NOT_PENDING|NOT_PENDING|[A-Z0-9_]*_NOT_PENDING_[A-Z0-9_]*|[A-Z0-9_]*NOT_IN_PROGRESS[A-Z0-9_]*|NO_PENDING_[A-Z0-9_]*|ALREADY_(DECIDED|APPROVED|REJECTED|PROCESSED|CLOSED|SUBMITTED|CANCELLED|CANCELED|PAID|POSTED|SIGNED|ISSUED|COMPLETED|FINALI[SZ]ED|REVERSED|WITHDRAWN|RESOLVED|VERIFIED|INACTIVE|ARCHIVED|RETIRED|REVOKED|FROZEN)|[A-Z0-9_]*_ALREADY_(DECIDED|APPROVED|REJECTED|PROCESSED|CLOSED|SUBMITTED|CANCELLED|CANCELED|PAID|POSTED|SIGNED|ISSUED|COMPLETED|FINALI[SZ]ED|REVERSED|WITHDRAWN|RESOLVED|VERIFIED))$/,
    object: { en: "item", hi: "मद" },
    message: msg(
      { what: "This item has already been decided or is not at this step.", next: "Refresh to see its current status." },
      { what: "इस मद पर पहले ही निर्णय हो चुका है, या यह इस चरण पर नहीं है।", next: "इसकी वर्तमान स्थिति देखने के लिए पेज रीफ़्रेश करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "windowClosed",
    pattern: /^(?:[A-Z0-9_]*_WINDOW_(EXPIRED|CLOSED|PASSED)|DEADLINE_PASSED|[A-Z0-9_]*_DEADLINE_PASSED|CLOSING_DATE_PAST|DEADLINE_IN_PAST)$/,
    message: msg(
      { what: "The time allowed for this has passed.", next: "Ask the officer in charge whether the time limit can be extended." },
      { what: "इसके लिए निर्धारित समय सीमा बीत चुकी है।", next: "प्रभारी अधिकारी से पूछें कि क्या समय सीमा बढ़ाई जा सकती है।" },
    ),
  },
  {
    id: "inUse",
    pattern: /^(?:[A-Z0-9_]*_IN_USE|IN_USE|HAS_ACTIVE_[A-Z0-9_]*|[A-Z0-9_]*_HAS_ACTIVE_[A-Z0-9_]*|[A-Z0-9_]*_HAS_(MEMBERS|ANSWERS|CHILDREN|DEPENDENTS|LINKS|ITEMS|ENTRIES|EMPLOYEES|RECORDS|TRANSACTIONS))$/,
    object: RECORD,
    message: msg(
      { what: "This {object} is still in use.", next: "Remove or reassign the linked items first, then try again." },
      { what: "यह {object} अभी उपयोग में है।", next: "पहले इससे जुड़ी प्रविष्टियाँ हटाएँ या किसी दूसरे को सौंपें, फिर प्रयास करें।" },
    ),
  },
  {
    id: "alreadyPending",
    pattern: /^(?:[A-Z0-9_]*(?:[A-Z0-9_]*_)?ALREADY_PENDING(?:_[A-Z0-9_]*)?[A-Z0-9_]*|REQUEST_ALREADY_OPEN)$/,
    message: msg(
      { what: "A request for this is already pending.", next: "Wait for it to be decided, then try again if you still need to." },
      { what: "इसके लिए एक अनुरोध पहले से लंबित है।", next: "उस पर निर्णय होने तक प्रतीक्षा करें, फिर ज़रूरत हो तो दोबारा प्रयास करें।" },
    ),
  },
  {
    id: "alreadyDone",
    pattern: /^(?:ALREADY_[A-Z_]+|[A-Z0-9_]*_ALREADY_[A-Z_]+)$/,
    except: /^(?:[A-Z0-9_]*PENDING[A-Z0-9_]*|[A-Z0-9_]*_OPEN)$/,
    message: msg(
      { what: "This has already been done.", next: "Refresh to see its current status." },
      { what: "यह कार्य पहले ही हो चुका है।", next: "इसकी वर्तमान स्थिति देखने के लिए पेज रीफ़्रेश करें।" },
      ["retry", "help"],
    ),
  },
  // Real state codes: an explicit state or transition rule, or a "not <state>" / "not <...>able" statement.
  {
    id: "stateTransition",
    pattern: /^(?:INVALID_STATE|[A-Z0-9_]*_INVALID_STATE|INVALID_[A-Z_]*TRANSITION|[A-Z0-9_]*_INVALID_TRANSITION|ILLEGAL_[A-Z_]*TRANSITION|NOT_ALLOWED_IN_[A-Z0-9_]*|[A-Z0-9_]*_NOT_ALLOWED_IN_[A-Z0-9_]*|WRONG_STAGE|WRONG_STATE|[A-Z0-9_]*_WRONG_STATE|[A-Z0-9_]*_BLOCKED|[A-Z0-9_]*_(NOT|NOT_YET)_(OPEN|APPROVED|SUBMITTED|DRAFT|PUBLISHED|FINALI[SZ]ED|FROZEN|SIGNED|ISSUED|COMPLETED|STARTED|VERIFIED|PREPARED|CONSOLIDATED|SHORTLISTED|EXTRACTED|ACTIVE|FINAL|PASSED|ACCEPTED_BY_[A-Z_]+)|NOT_(OPEN|APPROVED|SUBMITTED|DRAFT|PUBLISHED|FINALI[SZ]ED|FROZEN|SIGNED|COMPLETED|STARTED|PREPARED|CONSOLIDATED|SHORTLISTED|EXTRACTED|PAUSED|RESOLVED|BUILT|READY|ACTIVE|FINAL|PASSED)|[A-Z0-9_]*_NOT_[A-Z]+ABLE|NOT_[A-Z]+ABLE|[A-Z0-9_]*_(CLOSED|LOCKED|FROZEN|CANCELLED|WITHDRAWN|ARCHIVED|RETIRED|FINALI[SZ]ED|TERMINAL|IMMUTABLE|SUPERSEDED))$/,
    except: /^(?:[A-Z0-9_]*AVAILABLE|[A-Z0-9_]*REVEALABLE|[A-Z0-9_]*INVOCABLE|[A-Z0-9_]*UNVERIFIABLE|[A-Z0-9_]*APPLICABLE|MFA_LOCKED|[A-Z0-9_]*_IN_PRODUCTION|SSRF_BLOCKED|[A-Z0-9_]*INJECTION_BLOCKED|DEVICE_BLOCKED|GUARDRAIL_BLOCKED)$/,
    object: RECORD,
    message: msg(
      { what: "This {object} is not at a stage that allows this action.", next: "Refresh the page to see its current status, then choose an action that is available." },
      { what: "यह {object} ऐसे चरण में नहीं है जहाँ यह कार्रवाई की जा सके।", next: "इसकी वर्तमान स्थिति देखने के लिए पेज रीफ़्रेश करें, फिर उपलब्ध कार्रवाई चुनें।" },
      ["retry", "help"],
    ),
  },
  // CANNOT_<verb>: a state rule at 409/422, a permission refusal at 403; at any other status the status copy.
  {
    id: "cannotPermission",
    pattern: /^(?:CANNOT_[A-Z_]+)$/,
    onlyForStatus: [403],
    message: msg(
      {
        what: "This action isn't available to you.",
        next: "Only an officer with the right role can do it. Ask your administrator if you need access.",
      },
      {
        what: "यह कार्रवाई आपके लिए उपलब्ध नहीं है।",
        next: "इसे केवल उपयुक्त भूमिका वाले अधिकारी कर सकते हैं। पहुँच चाहिए तो अपने प्रशासक से कहें।",
      },
    ),
  },
  {
    id: "cannotState",
    pattern: /^(?:CANNOT_[A-Z_]+)$/,
    onlyForStatus: [409, 422],
    object: RECORD,
    message: msg(
      { what: "This {object} is not at a stage that allows this action.", next: "Refresh the page to see its current status, then choose an action that is available." },
      { what: "यह {object} ऐसे चरण में नहीं है जहाँ यह कार्रवाई की जा सके।", next: "इसकी वर्तमान स्थिति देखने के लिए पेज रीफ़्रेश करें, फिर उपलब्ध कार्रवाई चुनें।" },
      ["retry", "help"],
    ),
  },
  // Only links, tokens, codes and sessions "expire and can be requested again".
  { id: "session", pattern: /^(?:UNAUTHENTICATED|SESSION_(EXPIRED|ENDED)|TOKEN_EXPIRED|INVALID_TOKEN|UPSTREAM_UNAUTHENTICATED)$/, kind: "unauthenticated" },
  {
    id: "linkExpired",
    pattern: /^(?:(OTP|TOKEN|LINK|INVITE|INVITATION|RESET|RESET_TOKEN|MAGIC_LINK|CHALLENGE|NONCE|CALLBACK|VERIFICATION|VERIFICATION_CODE|CODE|DOWNLOAD_LINK|SIGNED_URL|URL)_EXPIRED|(TOKEN|LINK|CODE|BILL_TOKEN|INVITE)_(USED|REPLAYED|REUSED)|[A-Z0-9_]*_TOKEN_(EXPIRED|USED)|[A-Z0-9_]*_LINK_EXPIRED)$/,
    message: msg(
      { what: "This link or code has expired or has already been used.", next: "Start this step again to get a new one." },
      { what: "यह लिंक या कोड समाप्त हो चुका है या पहले ही इस्तेमाल हो चुका है।", next: "नया पाने के लिए यह चरण फिर से शुरू करें।" },
    ),
  },
  {
    id: "documentExpired",
    pattern: /^(?:(CONTRACT|EMPANELMENT|LICENCE|LICENSE|REGISTRATION|CERTIFICATE|POLICY|BG|BANK_GUARANTEE|INSURANCE|DSC|PERMIT|AGREEMENT|LEASE|MANDATE|NOC|ACCREDITATION|VALIDITY)_EXPIRED|[A-Z0-9_]*_(CONTRACT|EMPANELMENT|LICENCE|LICENSE|REGISTRATION|CERTIFICATE|POLICY|PERMIT|AGREEMENT|LEASE|MANDATE|DSC)_EXPIRED)$/,
    message: msg(
      { what: "This has expired.", next: "Renew it first (its record shows the expiry date), then try again." },
      { what: "इसकी वैधता समाप्त हो चुकी है।", next: "पहले इसका नवीनीकरण करें (इसके रिकॉर्ड में समाप्ति तिथि दी है), फिर प्रयास करें।" },
    ),
  },
  {
    id: "tooLow",
    pattern: /^(?:[A-Z0-9_]*_BELOW_[A-Z0-9_]*|[A-Z0-9_]*_BELOW|BELOW_[A-Z0-9_]*|[A-Z0-9_]*_MIN_[A-Z0-9_]*|MIN_[A-Z0-9_]*|[A-Z0-9_]*_TOO_(LOW|FEW|SMALL|SHORT)(?:_[A-Z0-9_]*)?[A-Z0-9_]*|NON_POSITIVE_[A-Z0-9_]*|[A-Z0-9_]*_NON_POSITIVE|[A-Z0-9_]*_ZERO_AMOUNT|ZERO_AMOUNT|[A-Z0-9_]*_NOT_POSITIVE)$/,
    message: msg(
      { what: "This is too low, or there are too few.", next: "Check the minimum shown on the form, enter a higher amount or add more, then try again." },
      { what: "यह बहुत कम है, या संख्या पर्याप्त नहीं है।", next: "फ़ॉर्म पर दी गई न्यूनतम सीमा देखें, अधिक राशि दर्ज करें या संख्या बढ़ाएँ, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "tooHigh",
    pattern: /^(?:[A-Z0-9_]*_EXCEEDS?_[A-Z0-9_]*|[A-Z0-9_]*_EXCEEDED|EXCEEDS_[A-Z0-9_]*|[A-Z0-9_]*_EXCEEDS|OVER_[A-Z0-9_]*|[A-Z0-9_]*_ABOVE_[A-Z0-9_]*|[A-Z0-9_]*_ABOVE|[A-Z0-9_]*_TOO_(HIGH|LARGE|MANY|LONG|BIG)(?:_[A-Z0-9_]*)?[A-Z0-9_]*|[A-Z0-9_]*_MAX_[A-Z0-9_]*|[A-Z0-9_]*_LIMIT_(REACHED|EXCEEDED)|[A-Z0-9_]*_CAP_REACHED|[A-Z0-9_]*OVERCLAIM[A-Z0-9_]*|[A-Z0-9_]*OVERPAYMENT[A-Z0-9_]*|[A-Z0-9_]*_AT_CAPACITY)$/,
    except: /^(?:MAX_ATTEMPTS)$/,
    message: msg(
      { what: "This is more than the allowed limit.", next: "Enter a lower amount or number, then try again. Ask your administrator if the limit needs to change." },
      { what: "यह अनुमत सीमा से अधिक है।", next: "कम राशि या संख्या दर्ज करें, फिर प्रयास करें। सीमा बदलनी हो तो अपने प्रशासक से पूछें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "overlap",
    pattern: /^(?:[A-Z0-9_]*_OVERLAP|OVERLAPPING_[A-Z0-9_]*|[A-Z0-9_]*_OVERLAPS)$/,
    message: msg(
      { what: "This clashes with an existing entry.", next: "Change the dates or the range so they don't clash with it, then try again." },
      { what: "यह किसी मौजूदा प्रविष्टि से टकराता है।", next: "तिथियाँ या सीमा इस तरह बदलें कि वे आपस में न टकराएँ, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "date",
    pattern: /^(?:[A-Z0-9_]*_IN_PAST|[A-Z0-9_]*_IN_FUTURE|DATE_IN_[A-Z0-9_]*|[A-Z0-9_]*_DATE_(BEFORE|AFTER)_[A-Z0-9_]*|[A-Z0-9_]*BACKDATE[A-Z0-9_]*)$/,
    except: /^(?:[A-Z0-9_]*_REQUIRED)$/,
    message: msg(
      { what: "This date isn't allowed for this action.", next: "Check the date against the rules shown on the form, then try again." },
      { what: "इस कार्रवाई के लिए यह तिथि मान्य नहीं है।", next: "फ़ॉर्म पर दिए नियमों के अनुसार तिथि जाँचें, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "notConfigured",
    pattern: /^(?:[A-Z0-9_]*_NOT_CONFIGURED|NOT_CONFIGURED|[A-Z0-9_]*_UNCONFIGURED|[A-Z0-9_]*_NOT_SET|[A-Z0-9_]*_NOT_SET_UP|CONFIG_INCOMPLETE)$/,
    message: msg(
      { what: "This hasn't been set up yet.", next: "Ask your administrator to complete the setup, then try again." },
      { what: "इसकी व्यवस्था अभी नहीं की गई है।", next: "अपने प्रशासक से व्यवस्था पूरी करवाएँ, फिर प्रयास करें।" },
    ),
  },
  {
    id: "disabled",
    pattern: /^(?:[A-Z0-9_]*_DISABLED|DISABLED|[A-Z0-9_]*_NOT_ENABLED|[A-Z0-9_]*_NOT_ENTITLED|[A-Z0-9_]*_NOT_PROVISIONED)$/,
    message: msg(
      { what: "This is switched off for your office.", next: "Ask your administrator to switch it on, then try again." },
      { what: "यह आपके कार्यालय के लिए बंद है।", next: "अपने प्रशासक से इसे चालू करवाएँ, फिर प्रयास करें।" },
    ),
  },
  {
    id: "inactive",
    pattern: /^(?:[A-Z0-9_]*_INACTIVE|INACTIVE|[A-Z0-9_]*_DEACTIVATED)$/,
    object: RECORD,
    message: msg(
      { what: "This {object} is inactive.", next: "Choose an active one, or ask your administrator to reactivate it." },
      { what: "यह {object} निष्क्रिय है।", next: "कोई सक्रिय विकल्प चुनें, या अपने प्रशासक से इसे फिर से सक्रिय करवाएँ।" },
    ),
  },
  {
    id: "blacklisted",
    pattern: /^(?:[A-Z0-9_]*_BLACKLISTED|[A-Z0-9_]*_DEBARRED)$/,
    message: msg(
      { what: "This party is blacklisted and can't be used.", next: "Choose another one. Ask the officer in charge if you think this is wrong." },
      { what: "यह पक्ष काली सूची में है और इसका उपयोग नहीं किया जा सकता।", next: "कोई दूसरा चुनें। यदि आपको लगता है कि यह ग़लत है तो प्रभारी अधिकारी से पूछें।" },
    ),
  },
  {
    id: "virusScan",
    pattern: /^(?:[A-Z0-9_]*INFECTED[A-Z0-9_]*|[A-Z0-9_]*MALWARE[A-Z0-9_]*)$/,
    message: msg(
      { what: "The file didn't pass the virus check, so it wasn't accepted.", next: "Upload a clean copy of the file." },
      { what: "फ़ाइल वायरस जाँच में सफल नहीं हुई, इसलिए स्वीकार नहीं की गई।", next: "फ़ाइल की कोई सुरक्षित प्रति अपलोड करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "required",
    pattern: /^(?:[A-Z0-9_]*_REQUIRED|MISSING_[A-Z0-9_]*|[A-Z0-9_]*_MISSING|MANDATORY_[A-Z_]*MISSING|[A-Z0-9_]*_NOT_UPLOADED|EMPTY_[A-Z0-9_]*|[A-Z0-9_]*_EMPTY)$/,
    // A missing approval, role, consent or technical header is not "information the user left out".
    except: /^(?:[A-Z0-9_]*(APPROVAL|ADMIN|WORKFLOW|CONSENT|IDENTITY|REQUISITION|NIT|REDIRECT|IDEMPOTENCY_KEY|ACK|APPEAL|OPERATOR|CHECKER|AGENT|ROLE|OTP|SANCTION|BASELINE|TS)_REQUIRED|MISSING_(TENANT|SESSION_ID|AUTHORITY|OTP|SIGNATURE|URL)|[A-Z0-9_]*_(KEY|CONFIG)_MISSING|CONFIG_MISSING|EMPTY_PATCH|REGISTRY_EMPTY)$/,
    deferToFieldErrors: true,
    message: msg(
      { what: "Some required information is missing.", next: "Fill in the missing details, then try again." },
      { what: "कुछ आवश्यक जानकारी नहीं भरी गई है।", next: "छूटी हुई जानकारी भरें, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  {
    id: "mismatch",
    pattern: /^(?:[A-Z0-9_]*_MISMATCH|MISMATCH_[A-Z0-9_]*|[A-Z0-9_]*_UNBALANCED|UNBALANCED_[A-Z0-9_]*)$/,
    // A 403 "mismatch" is a scope check (wrong department, gate, location), not a typing error.
    notForStatus: [401, 403],
    except: /^(?:(TENANT|SIGNEDINFO|RESOURCE|SUBJECT|DOMAIN|INITIATOR|DEPT|LOCATION|GATE_BINDING|SERVICE)_MISMATCH)$/,
    message: msg(
      { what: "Some details don't match.", next: "Check the values against the source document, then try again." },
      { what: "कुछ विवरण आपस में मेल नहीं खाते।", next: "मूल दस्तावेज़ से मान जाँचें, फिर प्रयास करें।" },
      ["retry", "help"],
    ),
  },
  // A 4xx carrying an upstream code (a gateway in front of a down service) is our problem, not the user's.
  // Only names that clearly name a service of ours (ADMIT_CARD_UNAVAILABLE, VARIANT_UNAVAILABLE are not outages).
  {
    id: "upstream",
    pattern: /^(?:[A-Z0-9_]*CIRCUIT_OPEN[A-Z0-9_]*|SERVICE_UNAVAILABLE|[A-Z0-9_]*_SERVICE_UNAVAILABLE|UPSTREAM_[A-Z0-9_]*|GATEWAY_(TIMEOUT|UNREACHABLE|ERROR)|DOWNSTREAM_[A-Z0-9_]*|(HRMS|FINANCE|PAYROLL|IDENTITY|DIRECTORY|OFFICER_DIRECTORY|STORAGE|AUDIT|ENCRYPTION|POLICY|ML|AI|SEARCH|SCAN|PDF_RENDERER|ROLE_LOOKUP|ORG_SERVICE|MODULE_GUARD|PO_VALIDATION|RECIPIENTS|STOCK|CLEARANCE|DOCUMENT_CHECK|FNF_HR_VERIFICATION|TEMPLATE_SERVICE|KNOWLEDGE_SERVICE|LOCATION_SERVICE)_UNAVAILABLE)$/,
    kind: "server",
  },
  { id: "validation", pattern: /^(?:INVALID_[A-Z0-9_]*|[A-Z0-9_]*_INVALID|[A-Z0-9_]*_INVALID_[A-Z0-9_]*|MALFORMED_[A-Z0-9_]*|[A-Z0-9_]*_MALFORMED|BAD_REQUEST|UNSUPPORTED_[A-Z0-9_]*|[A-Z0-9_]*_NOT_SUPPORTED|UNPROCESSABLE|PAYLOAD_[A-Z0-9_]*|[A-Z0-9_]*_SCHEMA_VIOLATION)$/, kind: "validation" },
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

/** The naming family a code belongs to at a status, or null (then the status copy is used). */
export function codeFamily(code: string, status?: number): Family | null {
  for (const f of CODE_FAMILIES) {
    if (!f.pattern.test(code) || (f.except && f.except.test(code))) continue;
    if (f.onlyForStatus && (status === undefined || !f.onlyForStatus.includes(status))) continue;
    if (f.notForStatus && status !== undefined && f.notForStatus.includes(status)) continue;
    return f;
  }
  return null;
}

/**
 * The HTTP statuses whose own copy always wins: the server failed (5xx), timed out
 * (408/504), refused for load (429) or the session ended (401). A code can only add a
 * dedicated message there when its entry is marked serverSide.
 */
export function isStatusAuthoritative(status: number | undefined): boolean {
  return status !== undefined && (status >= 500 || status === 429 || status === 408 || status === 401);
}

/** How a service code is explained: its own message, a family message, a family that reuses the copy of a kind, or null. */
export function resolveServiceCode(
  code: string | null | undefined,
  opts?: { hasFieldErrors?: boolean; status?: number },
): ServiceCodeResolution | null {
  if (!code) return null;
  const authoritative = isStatusAuthoritative(opts?.status);
  if (Object.prototype.hasOwnProperty.call(SERVICE_CODE_MESSAGES, code)) {
    const m = SERVICE_CODE_MESSAGES[code];
    if (!authoritative || m.serverSide || (m.alsoAt401 && opts?.status === 401)) return { source: "explicit", id: code, message: m };
    return null;
  }
  // Families refine a 4xx answer only; with no status (a bare code thrown in the browser) they also apply.
  if (authoritative) return null;
  if (opts?.status !== undefined && (opts.status < 400 || opts.status >= 500)) return null;
  const f = codeFamily(code, opts?.status);
  if (!f) return null;
  if (f.id === "duplicate") return { source: "family", id: "duplicate", duplicate: true };
  if (f.deferToFieldErrors && opts?.hasFieldErrors) return { source: "family", id: f.id, kind: "validation" };
  if (f.kind) return { source: "family", id: f.id, kind: f.kind, object: f.object };
  if (f.message) return { source: "family", id: f.id, message: f.message, object: f.object };
  return null;
}

/** The copy for a locale. */
export function codeCopy(m: ServiceCodeMessage, locale: ErrorLocale): CodeCopy {
  return m[locale];
}
