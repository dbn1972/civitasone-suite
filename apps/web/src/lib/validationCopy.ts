/**
 * UAT T-EDGE bundle 21: plain-language en/hi copy for the FIELD-level codes the services now put
 * in `fieldErrors[].code` (packages/schemas/src/validators.ts FIELD_CODES and a few route codes),
 * the decider name on TASK_ALREADY_DECIDED, and the session-expired signal (TE-10).
 *
 * Top-level codes are in errorCatalogue.ts DOMAIN_CODE_MESSAGES (the #2451 layer); this module
 * only adds what that table cannot express: per-field copy and a message with a name in it.
 * A code with no entry here falls back to the backend field message, as before.
 */
import { getClientLocale, type ErrorLocale } from "./errorCatalogue";

type Copy = { en: string; hi: string };

export const FIELD_CODE_COPY: Record<string, Copy> = {
  DATE_INVALID: { en: "Enter a real calendar date.", hi: "सही कैलेंडर तारीख दर्ज करें।" },
  DATE_TOO_EARLY: { en: "This date is too far in the past.", hi: "यह तारीख बहुत पुरानी है।" },
  DATE_TOO_LATE: { en: "This date is too far ahead.", hi: "यह तारीख बहुत आगे की है।" },
  DATE_IN_FUTURE: { en: "This date cannot be in the future.", hi: "यह तारीख भविष्य की नहीं हो सकती।" },
  DATE_IN_PAST: { en: "This date cannot be in the past.", hi: "यह तारीख बीते समय की नहीं हो सकती।" },
  DATE_ORDER: { en: "These dates are in the wrong order. The later date must not come before the earlier one.", hi: "ये तारीखें गलत क्रम में हैं। बाद वाली तारीख, पहले वाली तारीख से पहले नहीं हो सकती।" },
  AGE_OUT_OF_RANGE: { en: "The age on the date of joining must be between 18 and 70 years.", hi: "कार्यग्रहण की तारीख पर आयु 18 से 70 वर्ष के बीच होनी चाहिए।" },
  TEXT_BLANK: { en: "This cannot be blank or only spaces.", hi: "यह खाली या केवल रिक्त स्थान नहीं हो सकता।" },
  AADHAAR_INVALID: { en: "Enter the full 12-digit Aadhaar number. Only the last 4 digits are kept.", hi: "पूरा 12 अंकों का आधार नंबर दर्ज करें। केवल अंतिम 4 अंक रखे जाते हैं।" },
  IFSC_INVALID: { en: "Enter the 11-character IFSC, for example SBIN0001234 (the fifth character is a zero).", hi: "11 अक्षरों का IFSC दर्ज करें, जैसे SBIN0001234 (पाँचवाँ अक्षर शून्य होता है)।" },
  UAN_INVALID: { en: "Enter the 12-digit UAN.", hi: "12 अंकों का UAN दर्ज करें।" },
  GSTIN_INVALID: { en: "This GSTIN is not valid. Check the state code, the PAN part and the last character.", hi: "यह GSTIN मान्य नहीं है। राज्य कोड, PAN वाला भाग और अंतिम अक्षर जाँचें।" },
  MOBILE_INVALID: { en: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9 (+91 is optional).", hi: "6, 7, 8 या 9 से शुरू होने वाला 10 अंकों का मोबाइल नंबर दर्ज करें (+91 वैकल्पिक है)।" },
  PAN_INVALID: { en: "Enter the 10-character PAN, for example ABCDE1234F.", hi: "10 अक्षरों का PAN दर्ज करें, जैसे ABCDE1234F।" },
  AMOUNT_TOO_LARGE: { en: "This amount is too large. Check the number of digits.", hi: "यह राशि बहुत बड़ी है। अंकों की संख्या जाँचें।" },
  FY_INVALID: { en: "Enter the financial year as YYYY-YY with consecutive years, for example 2026-27.", hi: "वित्तीय वर्ष YYYY-YY रूप में लगातार वर्षों के साथ दर्ज करें, जैसे 2026-27।" },
  ACCEPTED_EXCEEDS_RECEIVED: { en: "The accepted quantity cannot be more than the received quantity.", hi: "स्वीकृत मात्रा, प्राप्त मात्रा से अधिक नहीं हो सकती।" },
  INDENT_NOT_FOUND: { en: "Choose an existing, approved indent.", hi: "कोई मौजूदा, अनुमोदित मांग-पत्र चुनें।" },
  INDENT_NOT_APPROVED: { en: "The indent must be approved first.", hi: "पहले मांग-पत्र का अनुमोदन होना चाहिए।" },
  INDENT_BUDGET_EXCEEDED: { en: "The order is more than the indent still allows.", hi: "यह आदेश मांग-पत्र में बची राशि से अधिक है।" },
  PO_LINE_NOT_FOUND: { en: "Choose a line of this purchase order.", hi: "इस क्रय आदेश की कोई पंक्ति चुनें।" },
  HEAD_NOT_FOUND: { en: "Choose an existing budget head.", hi: "कोई मौजूदा बजट शीर्ष चुनें।" },
  ALLOCATION_BELOW_COMMITTED: { en: "This is less than what is already committed or spent on this head.", hi: "यह इस शीर्ष पर पहले से प्रतिबद्ध या खर्च राशि से कम है।" },
  UNKNOWN_ACCOUNT_CODE: { en: "This account code is not in the chart of accounts.", hi: "यह खाता कोड लेखा-सूची में नहीं है।" },
  HOA_EMPTY: { en: "This head has no head-of-account code yet.", hi: "इस शीर्ष का लेखा शीर्ष कोड अभी तय नहीं है।" },
  HOA_UNKNOWN_MAJOR_HEAD: { en: "The major head of this head is not in the master.", hi: "इस शीर्ष का मुख्य शीर्ष सूची में नहीं है।" },
};

/** The en/hi copy for a field code, or undefined (caller keeps the backend field message). */
export function fieldCodeMessage(code: string | undefined | null, locale: ErrorLocale = getClientLocale()): string | undefined {
  if (!code || !Object.prototype.hasOwnProperty.call(FIELD_CODE_COPY, code)) return undefined;
  return FIELD_CODE_COPY[code]![locale];
}

/** Who decided a task, as the 409 TASK_ALREADY_DECIDED body carries it. */
export type DecidedBy = { id?: string; name?: string | null } | null | undefined;

/**
 * TE-08: the message for the losing checker, naming the officer who decided first when the
 * answer carries the name; null when it does not (the catalogue copy then applies).
 */
export function taskAlreadyDecidedMessage(decidedBy: DecidedBy, locale: ErrorLocale = getClientLocale()): string | null {
  const name = typeof decidedBy?.name === "string" ? decidedBy.name.trim() : "";
  if (!name) return null;
  return locale === "hi"
    ? `${name} इस पर पहले ही निर्णय ले चुके हैं। आपका निर्णय दर्ज नहीं किया गया। नवीनतम स्थिति देखने के लिए पेज रीफ़्रेश करें।`
    : `${name} has already decided this. Your decision was not recorded. Refresh to see the latest status.`;
}

/** Browser event fired when an API call answers 401 (the session has expired). */
export const SESSION_EXPIRED_EVENT = "civitasone:session-expired";

/** Tell the page shell the session has expired (shows the sign-in notice; form values stay). */
export function signalSessionExpired(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } catch {
    // An old browser without CustomEvent: the inline form message still says what to do.
  }
}
