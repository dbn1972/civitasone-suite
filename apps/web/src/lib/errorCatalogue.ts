/**
 * The app-wide error-message standard (apps/web/docs/ERROR-MESSAGES.md).
 *
 * One catalogue, one resolver. Every helper that turns a failed request into
 * user-facing words (errorMessageFromResponse, useFormError, LoadErrorState,
 * route error boundaries, uploads) goes through `resolveHumanError`, so the
 * wording is identical everywhere and an HTTP status number, backend `code`,
 * backend `message` or stack text can never reach the screen.
 *
 * Based on the GOV.UK Design System error-message guidance, Nielsen Norman
 * Group error-message guidelines, and WCAG 2.2 SC 3.3.1 / 3.3.3 / 4.1.3.
 */

import { isStatusAuthoritative, resolveServiceCode } from "./serviceErrorCodes";

export type ErrorLocale = "en" | "hi";

/** The situations the standard distinguishes. */
export type ErrorStatusKind =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "notFound"
  /** 409 / a state rule: neutral, never claims a concurrent edit (most 409s are state or in-use rules). */
  | "conflict"
  /** A genuine concurrent edit: 412, or a version / ETag / STALE / CONCURRENT code. */
  | "concurrentEdit"
  | "tooLarge"
  | "unsupportedType"
  | "rateLimited"
  | "server"
  | "network"
  /** The server took too long to answer (408, 504, or our own request timeout). Not the user's connection. */
  | "timeout"
  /** A failure whose cause is not known (a thrown error with no response). Never blames the connection. */
  | "unknown";

/** Safe recovery actions the UI may offer for a message. */
export type StandardAction = "retry" | "back" | "help" | "signin";

/** What the user was doing; picks the verb and whether "changes not saved" is true. */
export type ErrorIntent = "load" | "save" | "submit" | "delete" | "update" | "approve" | "upload";

export type ErrorContext = {
  /** Plain noun for the object, e.g. "leave request". Optional. */
  area?: string;
  intent?: ErrorIntent;
  /** For 413: a human limit such as "5 MB". */
  limit?: string;
  /** For 415: accepted types such as "PDF or JPG". */
  types?: string;
  /** True when the failure carries field-level messages: the 400 copy then points at "the highlighted fields". */
  hasFieldErrors?: boolean;
  locale?: ErrorLocale;
};

type Entry = {
  what: string;
  next: string;
  nextRead?: string;
  /** Used instead of what/next when the failure carries no field-level messages (validation only). */
  neutral?: { what: string; next: string };
};

type Catalogue = {
  kinds: Record<ErrorStatusKind, Entry>;
  /** Object noun used when the caller gave no `area`. */
  defaultObject: string;
  defaultLimit: string;
  defaultTypes: string;
  verbs: Record<ErrorIntent, string>;
  referenceLabel: string;
  /** Heading of the 403 card. */
  accessRestricted: string;
};

const EN: Catalogue = {
  kinds: {
    validation: {
      what: "Some details need changing.",
      next: "Check the highlighted fields and try again.",
      neutral: {
        what: "Some details weren't accepted.",
        next: "Check what you entered and try again.",
      },
    },
    unauthenticated: { what: "Your session has ended.", next: "Sign in again to continue." },
    forbidden: {
      what: "You don't have permission to do this.",
      next: "Ask your administrator if you need access.",
    },
    notFound: {
      what: "We couldn't find this {object}.",
      next: "It may have been removed or the link may be wrong.",
    },
    conflict: {
      what: "This action can't be done on this {object} right now.",
      next: "It may have changed, or be in a state that doesn't allow it. Refresh to see its current status.",
    },
    concurrentEdit: {
      what: "This {object} was changed by someone else.",
      next: "Refresh to see the latest version, then try again.",
    },
    tooLarge: { what: "The file is too large.", next: "Upload a file smaller than {limit}." },
    unsupportedType: {
      what: "This file type isn't accepted.",
      next: "Upload a {types} file.",
    },
    rateLimited: { what: "Too many attempts.", next: "Wait a minute, then try again." },
    server: {
      what: "We couldn't {verb} the {object} because of a problem on our side.",
      next: "Your changes haven't been saved. Try again in a few minutes.",
      nextRead: "Try again in a few minutes.",
    },
    // Only for a genuine browser-side failure (the request never left the browser, or the browser is offline).
    network: {
      what: "We couldn't connect.",
      next: "Check your internet connection and try again.",
    },
    timeout: {
      what: "We couldn't {verb} the {object} in time.",
      next: "The system is taking longer than usual. Check whether your changes were saved before you try again.",
      nextRead: "The system is taking longer than usual. Try again in a few minutes.",
    },
    // Cause not known: say so honestly, without naming the user's connection as the cause.
    unknown: {
      what: "We couldn't {verb} the {object}.",
      next: "Your changes may not have been saved. Check before you try again. If it keeps happening, contact your support team.",
      nextRead: "Try again in a few minutes. If it keeps happening, contact your support team.",
    },
  },
  defaultObject: "information",
  defaultLimit: "the allowed size",
  defaultTypes: "supported",
  verbs: {
    load: "load",
    save: "save",
    submit: "submit",
    delete: "delete",
    update: "update",
    approve: "approve",
    upload: "upload",
  },
  referenceLabel: "Reference",
  accessRestricted: "Access restricted",
};

const HI: Catalogue = {
  kinds: {
    validation: {
      what: "कुछ विवरण बदलने होंगे।",
      next: "हाइलाइट किए गए फ़ील्ड जाँचें और फिर से प्रयास करें।",
      neutral: {
        what: "कुछ विवरण स्वीकार नहीं किए गए।",
        next: "आपने जो दर्ज किया है उसे जाँचें और फिर से प्रयास करें।",
      },
    },
    unauthenticated: {
      what: "आपका सत्र समाप्त हो गया है।",
      next: "जारी रखने के लिए फिर से साइन इन करें।",
    },
    forbidden: {
      what: "आपको यह कार्य करने की अनुमति नहीं है।",
      next: "पहुँच चाहिए तो अपने व्यवस्थापक से कहें।",
    },
    notFound: {
      what: "हमें यह {object} नहीं मिला।",
      next: "हो सकता है इसे हटा दिया गया हो या लिंक गलत हो।",
    },
    conflict: {
      what: "यह कार्रवाई अभी इस {object} पर नहीं की जा सकती।",
      next: "हो सकता है इसमें बदलाव हुआ हो, या यह ऐसी स्थिति में हो जिसमें यह कार्रवाई संभव नहीं है। इसकी वर्तमान स्थिति देखने के लिए पेज रीफ़्रेश करें।",
    },
    concurrentEdit: {
      what: "यह {object} किसी और ने बदल दिया है।",
      next: "नवीनतम संस्करण देखने के लिए पेज रीफ़्रेश करें, फिर दोबारा प्रयास करें।",
    },
    tooLarge: {
      what: "फ़ाइल बहुत बड़ी है।",
      next: "{limit} से छोटी फ़ाइल अपलोड करें।",
    },
    unsupportedType: {
      what: "इस प्रकार की फ़ाइल स्वीकार नहीं की जाती।",
      next: "{types} फ़ाइल अपलोड करें।",
    },
    rateLimited: {
      what: "बहुत ज़्यादा प्रयास हो गए हैं।",
      next: "एक मिनट रुकें, फिर दोबारा प्रयास करें।",
    },
    server: {
      what: "हमारी ओर की समस्या के कारण हम {object} को {verb} सके।",
      next: "आपके बदलाव सहेजे नहीं गए हैं। कुछ मिनट बाद फिर प्रयास करें।",
      nextRead: "कुछ मिनट बाद फिर प्रयास करें।",
    },
    network: {
      what: "हम कनेक्ट नहीं हो सके।",
      next: "अपना इंटरनेट कनेक्शन जाँचें और फिर प्रयास करें।",
    },
    timeout: {
      what: "हम {object} को समय पर {verb} सके।",
      next: "सिस्टम सामान्य से अधिक समय ले रहा है। दोबारा प्रयास करने से पहले जाँच लें कि आपके बदलाव सहेजे गए या नहीं।",
      nextRead: "सिस्टम सामान्य से अधिक समय ले रहा है। कुछ मिनट बाद फिर प्रयास करें।",
    },
    unknown: {
      what: "हम {object} को {verb} सके।",
      next: "हो सकता है आपके बदलाव सहेजे न गए हों। दोबारा प्रयास करने से पहले जाँच लें। समस्या बनी रहे तो अपनी सहायता टीम से संपर्क करें।",
      nextRead: "कुछ मिनट बाद फिर प्रयास करें। समस्या बनी रहे तो अपनी सहायता टीम से संपर्क करें।",
    },
  },
  defaultObject: "जानकारी",
  defaultLimit: "अनुमत आकार",
  defaultTypes: "समर्थित",
  verbs: {
    load: "लोड नहीं कर",
    save: "सहेज नहीं",
    submit: "जमा नहीं कर",
    delete: "हटा नहीं",
    update: "अपडेट नहीं कर",
    approve: "मंज़ूर नहीं कर",
    upload: "अपलोड नहीं कर",
  },
  referenceLabel: "संदर्भ",
  accessRestricted: "पहुँच प्रतिबंधित",
};

/** Exported for the en/hi parity tests. */
export const ERROR_CATALOGUE: Record<ErrorLocale, Catalogue> = { en: EN, hi: HI };

/**
 * Domain-specific messages. A known backend `code` always wins over the generic
 * status copy, so the user hears the specific reason ("You can't approve your
 * own request") instead of a generic conflict. The code itself is never shown.
 * Extend this table as codes are catalogued.
 */
/** serverSide: the message stays true for a 5xx / 429 / 408 / 401 answer too. */
export type DomainMessage = { en: Entry; hi: Entry; actions?: StandardAction[]; serverSide?: boolean };

const SELF_APPROVAL_MESSAGE: DomainMessage = {
    en: {
      what: "You can't approve your own request.",
      next: "Another approver needs to do this.",
    },
    hi: {
      what: "आप अपना अनुरोध खुद मंज़ूर नहीं कर सकते।",
      next: "यह कार्य किसी दूसरे अनुमोदक को करना होगा।",
    },
    actions: ["back", "help"],
};

const MAKER_CHECKER_MESSAGE: DomainMessage = {
  en: {
    what: "This needs approval from someone other than the person who made it.",
    next: "Another approver needs to do this.",
  },
  hi: {
    what: "इसे बनाने वाले व्यक्ति के अलावा किसी और की मंज़ूरी चाहिए।",
    next: "यह कार्य किसी दूसरे अनुमोदक को करना होगा।",
  },
  actions: ["back", "help"],
};

export const DOMAIN_CODE_MESSAGES: Record<string, DomainMessage> = {
  // works-service: a measurement can only be recorded while its measurement book is a draft (billing MB_NOT_OPEN).
  MB_NOT_OPEN: {
    en: {
      what: "This measurement book is no longer open for new measurements.",
      next: "Measurements can only be recorded while a measurement book is a draft. Choose a draft measurement book.",
    },
    hi: {
      what: "यह माप पुस्तिका अब नई माप दर्ज करने के लिए खुली नहीं है।",
      next: "माप तभी दर्ज की जा सकती है जब माप पुस्तिका ड्राफ़्ट अवस्था में हो। कोई ड्राफ़्ट माप पुस्तिका चुनें।",
    },
    actions: ["back", "help"],
  },
  // Every "you cannot decide your own request" code the services emit (verified in services/*).
  SELF_APPROVAL_FORBIDDEN: SELF_APPROVAL_MESSAGE,
  SELF_APPROVAL: SELF_APPROVAL_MESSAGE,
  SELF_APPROVAL_DENIED: SELF_APPROVAL_MESSAGE,
  FNF_SELF_APPROVAL_FORBIDDEN: SELF_APPROVAL_MESSAGE,
  // Maker-checker: the approver must be a different person from the maker.
  MAKER_CHECKER: MAKER_CHECKER_MESSAGE,
  MAKER_CHECKER_VIOLATION: MAKER_CHECKER_MESSAGE,
  // GAP-HR-WFH-01: hrms-service POST /v1/hrms/wfh-requests answers 422 with one
  // of these two codes. They are policy outcomes (not a typo to fix), so they
  // must read as their specific reason, never "Some details need changing".
  // The pay-level threshold and the on/off switch are per-tenant policy, so
  // the copy deliberately names neither a level nor a staff group.
  GAZETTED_NOT_ELIGIBLE: {
    en: {
      what: "Work from home isn't available at this employee's pay level.",
      next: "It is limited to the pay levels your office has made eligible. Ask HR if you think this is wrong.",
    },
    hi: {
      what: "इस कर्मचारी के वेतन स्तर पर घर से कार्य उपलब्ध नहीं है।",
      next: "यह केवल उन वेतन स्तरों के लिए है जिन्हें आपके कार्यालय ने पात्र माना है। यदि आपको लगता है कि यह ग़लत है तो एचआर से पूछें।",
    },
    actions: ["back", "help"],
  },
  WEEKLY_WFH_CAP_REACHED: {
    en: {
      what: "These dates would go over the weekly work-from-home limit.",
      next: "Choose fewer days, or dates in a different week, and try again.",
    },
    hi: {
      what: "इन तिथियों से सप्ताह की घर से कार्य की सीमा पार हो जाएगी।",
      next: "कम दिन चुनें, या किसी दूसरे सप्ताह की तिथियाँ चुनें, फिर दोबारा प्रयास करें।",
    },
    actions: ["retry", "help"],
  },
  // GAP-CHANGE-DETAIL-05: admin-service change domain codes
  // (services/admin-service/src/modules/change/domain.ts). Each is a specific,
  // actionable governance reason that must read differently from a generic
  // network/"conflict" failure so a CAB member knows what to do next.
  FREEZE_CONFLICT: {
    en: {
      what: "This release window overlaps a change freeze.",
      next: "Pick a window outside the freeze, or get the freeze lifted first.",
    },
    hi: {
      what: "यह रिलीज़ विंडो एक चेंज फ़्रीज़ से टकराती है।",
      next: "फ़्रीज़ के बाहर कोई विंडो चुनें, या पहले फ़्रीज़ हटवाएँ।",
    },
    actions: ["back", "help"],
  },
  ROLLBACK_REQUIRED: {
    en: {
      what: "A rollback plan is required before this change can be approved.",
      next: "Add a rollback plan to the change, then approve it.",
    },
    hi: {
      what: "इस बदलाव को मंज़ूर करने से पहले एक रोलबैक योजना ज़रूरी है।",
      next: "बदलाव में रोलबैक योजना जोड़ें, फिर मंज़ूर करें।",
    },
    actions: ["back", "help"],
  },
  // Verified in services/*: the loan creator may not also disburse it.
  SELF_DISBURSE_FORBIDDEN: {
    en: {
      what: "You can't disburse a loan you created.",
      next: "Another officer needs to do this.",
    },
    hi: {
      what: "आप अपना बनाया हुआ ऋण स्वयं वितरित नहीं कर सकते।",
      next: "यह कार्य किसी दूसरे अधिकारी को करना होगा।",
    },
    actions: ["back", "help"],
  },
  // Verified in services/*: the appraisee may not act as the reporting / reviewing / accepting officer.
  SELF_REVIEW_FORBIDDEN: {
    en: {
      what: "You can't review your own appraisal.",
      next: "Another officer needs to do this.",
    },
    hi: {
      what: "आप अपना मूल्यांकन स्वयं नहीं देख सकते।",
      next: "यह कार्य किसी दूसरे अधिकारी को करना होगा।",
    },
    actions: ["back", "help"],
  },
  STALE_OVERRIDE: {
    en: {
      what: "This application changed after the override was raised.",
      next: "Refresh to see the latest version, then raise the override again.",
    },
    hi: {
      what: "ओवरराइड उठाए जाने के बाद यह आवेदन बदल गया है।",
      next: "नवीनतम संस्करण देखने के लिए रीफ़्रेश करें, फिर ओवरराइड दोबारा उठाएँ।",
    },
    actions: ["retry", "help"],
  },
  STALE_VERSION: {
    en: {
      what: "This record was changed by someone else.",
      next: "Refresh to see the latest version, then try again.",
    },
    hi: {
      what: "यह रिकॉर्ड किसी और ने बदल दिया है।",
      next: "नवीनतम संस्करण देखने के लिए रीफ़्रेश करें, फिर दोबारा प्रयास करें।",
    },
    actions: ["retry", "help"],
  },
  STALE_ELECTION: {
    en: {
      what: "This election was changed by someone else.",
      next: "Refresh to see the latest version, then choose again.",
    },
    hi: {
      what: "यह चुनाव किसी और ने बदल दिया है।",
      next: "नवीनतम संस्करण देखने के लिए रीफ़्रेश करें, फिर दोबारा चुनें।",
    },
    actions: ["retry", "help"],
  },
  DESIGNATION_IN_USE: {
    en: {
      what: "This can't be done while it's still in use elsewhere.",
      next: "Update or reassign whatever depends on it first, then try again.",
    },
    hi: {
      what: "जब तक यह कहीं और इस्तेमाल में है, यह नहीं हो सकता।",
      next: "पहले जो इस पर निर्भर है उसे बदलें या दूसरे को सौंपें, फिर प्रयास करें।",
    },
    actions: ["back", "help"],
  },
  // GAP-HR-DEPARTMENTS-02: DELETE /v1/hrms/departments/:id answers 409 with this
  // code while the department still has sub-departments or active employees.
  // Without its own entry the generic 409 "changed by someone else" copy was
  // shown, which tells the clerk the wrong thing to do.
  DEPARTMENT_IN_USE: {
    en: {
      what: "This department still has sub-departments or employees.",
      next: "Move or reassign them first, then try again.",
    },
    hi: {
      what: "इस विभाग में अभी भी उप-विभाग या कर्मचारी हैं।",
      next: "पहले उन्हें किसी दूसरे विभाग में भेजें या सौंपें, फिर प्रयास करें।",
    },
    actions: ["back", "help"],
  },
  DUPLICATE_CODE: {
    en: {
      what: "This code is already in use.",
      next: "Choose a different code and try again.",
    },
    hi: {
      what: "यह कोड पहले से इस्तेमाल में है।",
      next: "कोई अलग कोड चुनें और फिर प्रयास करें।",
    },
    actions: ["retry", "help"],
  },
  // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06: the same endpoint (and journal approval) answers 422 when the posting
  // date falls in an accounting period that cannot take the entry. Nothing was posted.
  PERIOD_CLOSED: {
    en: {
      what: "This accounting period is closed, so nothing was posted.",
      next: "Choose a posting date in an open period.",
    },
    hi: {
      what: "यह लेखा अवधि बंद है, इसलिए कुछ भी पोस्ट नहीं हुआ।",
      next: "खुली अवधि की कोई पोस्टिंग तिथि चुनें।",
    },
    actions: ["back", "help"],
  },
  PERIOD_SOFT_CLOSED: {
    en: {
      what: "This accounting period is only open for adjustment and closing entries, so nothing was posted.",
      next: "Choose a posting date in an open period.",
    },
    hi: {
      what: "यह लेखा अवधि केवल समायोजन और समापन प्रविष्टियों के लिए खुली है, इसलिए कुछ भी पोस्ट नहीं हुआ।",
      next: "खुली अवधि की कोई पोस्टिंग तिथि चुनें।",
    },
    actions: ["back", "help"],
  },
  PERIOD_UNKNOWN: {
    en: {
      what: "The posting date is not a date we can post to.",
      next: "Choose a real calendar date and try again.",
    },
    hi: {
      what: "पोस्टिंग तिथि ऐसी तिथि नहीं है जिस पर पोस्ट किया जा सके।",
      next: "कैलेंडर की कोई वास्तविक तिथि चुनें और फिर प्रयास करें।",
    },
    actions: ["retry", "help"],
  },
  // fx-p3 (finance-service GFR controls): 422 when an expenditure posting / bill pass hits a head with no budget
  // provision for the financial year (GFR: no expenditure without a provision). Nothing was posted or passed.
  NO_BUDGET_PROVISION: {
    en: {
      what: "There is no budget provision for this head in this financial year, so nothing was posted or passed (GFR: no expenditure without a budget provision).",
      next: "Ask the budget section to make a provision for this head and year (budget estimate, supplementary grant or re-appropriation), then try again. Receipts are not affected.",
    },
    hi: {
      what: "इस वित्तीय वर्ष में इस मद के लिए कोई बजट प्रावधान नहीं है, इसलिए कुछ भी पोस्ट या पारित नहीं हुआ (GFR: बजट प्रावधान के बिना कोई व्यय नहीं)।",
      next: "बजट अनुभाग से इस मद और वर्ष के लिए प्रावधान (बजट अनुमान, अनुपूरक अनुदान या पुनर्विनियोजन) करवाएँ, फिर प्रयास करें। प्राप्तियों पर इसका कोई असर नहीं है।",
    },
    actions: ["back", "help"],
  },
  // fx-p3: 422 when the posting date falls in a financial year that has not been activated yet. Nothing was posted.
  FY_NOT_ACTIVE: {
    en: {
      what: "The posting date is in a financial year that is not active yet, so nothing was posted.",
      next: "Choose a date in the active year, or ask the finance administrator to activate that year.",
    },
    hi: {
      what: "पोस्टिंग तिथि ऐसे वित्तीय वर्ष में है जो अभी सक्रिय नहीं है, इसलिए कुछ भी पोस्ट नहीं हुआ।",
      next: "सक्रिय वर्ष की कोई तिथि चुनें, या वित्त प्रशासक से उस वर्ष को सक्रिय करने के लिए कहें।",
    },
    actions: ["back", "help"],
  },
  // fx-p3: 422 from the depreciation run for a month that has not ended (or not started) yet.
  DEP_FUTURE_PERIOD: {
    en: {
      what: "Depreciation cannot be charged for a month that has not ended yet, so nothing was posted.",
      next: "Choose a month that has already ended and run depreciation again.",
    },
    hi: {
      what: "जो महीना अभी समाप्त नहीं हुआ है उसके लिए मूल्यह्रास नहीं लगाया जा सकता, इसलिए कुछ भी पोस्ट नहीं हुआ।",
      next: "कोई ऐसा महीना चुनें जो समाप्त हो चुका हो और मूल्यह्रास फिर से चलाएँ।",
    },
    actions: ["back", "help"],
  },
  // fx-p3: 409 when a reopen request for a hard-closed period is already waiting for a second officer.
  PERIOD_REOPEN_PENDING: {
    en: {
      what: "A request to reopen this period is already waiting for a second officer.",
      next: "Wait for another finance administrator to approve or reject it in the pending approvals list.",
    },
    hi: {
      what: "इस अवधि को फिर से खोलने का एक अनुरोध पहले से दूसरे अधिकारी की स्वीकृति की प्रतीक्षा में है।",
      next: "लंबित स्वीकृतियों की सूची में किसी दूसरे वित्त प्रशासक के स्वीकार या अस्वीकार करने की प्रतीक्षा करें।",
    },
    actions: ["back", "help"],
  },
  // fx-p3: 409 when a period reopen (or a posting) targets a month whose financial year has already been closed
  // by the year-end close. The year is final; corrections go in as a prior-period adjustment in the open year.
  FY_CLOSED: {
    en: {
      what: "The financial year of this month has been closed (the year-end close has run and its accounts are final), so this month cannot be reopened and nothing can be posted into it.",
      next: "Make the correction as a prior-period adjustment in the current open year. Ask the finance admin if you need help.",
    },
    hi: {
      what: "इस महीने का वित्तीय वर्ष बंद हो चुका है (वर्ष-समापन हो चुका है और उसके लेखे अंतिम हैं), इसलिए यह महीना फिर से नहीं खोला जा सकता और इसमें कुछ भी पोस्ट नहीं किया जा सकता।",
      next: "सुधार को चालू खुले वर्ष में पूर्व-अवधि समायोजन के रूप में करें। सहायता के लिए वित्त प्रशासक से पूछें।",
    },
    actions: ["back", "help"],
  },
  // fx-p3: 409 from fiscal-year activation / year-end close while a month of the year is not hard-closed.
  FY_OPEN_PERIODS: {
    en: {
      what: "Every month of this financial year must be hard-closed first, so nothing was changed.",
      next: "Hard-close the remaining months in Period Close, then try again.",
    },
    hi: {
      what: "पहले इस वित्तीय वर्ष के हर महीने को पूरी तरह बंद (हार्ड-क्लोज़) करना होगा, इसलिए कुछ भी नहीं बदला।",
      next: "अवधि समापन में बचे हुए महीनों को हार्ड-क्लोज़ करें, फिर प्रयास करें।",
    },
    actions: ["back", "help"],
  },
  // fx-p3: 409 from year-end close when next year opening balances were already entered by hand.
  OPENING_BALANCES_MANUAL: {
    en: {
      what: "Opening balances for the next year were entered by hand, so the year-end step cannot generate them and nothing was changed.",
      next: "Review those opening balances with the finance administrator before running the year-end close again.",
    },
    hi: {
      what: "अगले वर्ष के प्रारंभिक शेष हाथ से दर्ज किए गए हैं, इसलिए वर्ष-समापन चरण उन्हें नहीं बना सकता और कुछ भी नहीं बदला।",
      next: "वर्ष-समापन दोबारा चलाने से पहले वित्त प्रशासक के साथ उन प्रारंभिक शेषों की समीक्षा करें।",
    },
    actions: ["back", "help"],
  },
  // fx-p3 (payroll-service): 409 when a hand-typed payroll run number is already used in the office.
  DUPLICATE_RUN_NO: {
    en: {
      what: "This payroll run number is already used.",
      next: "Choose another run number and try again.",
    },
    hi: {
      what: "यह पेरोल रन नंबर पहले से इस्तेमाल में है।",
      next: "कोई दूसरा रन नंबर चुनें और फिर प्रयास करें।",
    },
    actions: ["retry", "help"],
  },
  // fx-p3 (payroll-service, shared with PR #2463): 422 when Form 16 / 24Q needs the employer (deductor) name, TAN or PAN
  // and it is missing or malformed. Deductor identity lives in tenant settings (documentIdentity; shown to clerks as office settings), not payroll settings.
  FORM16_EMPLOYER_NOT_CONFIGURED: {
    en: {
      what: "The employer (deductor) name, TAN or PAN is missing or not in the right format in the office settings (document identity), so the form or return was not generated.",
      next: "Ask the office administrator to set the employer details in the office settings (document identity), then try again.",
    },
    hi: {
      what: "कार्यालय सेटिंग (दस्तावेज़ पहचान) में नियोक्ता (कटौतीकर्ता) का नाम, TAN या PAN नहीं है या सही प्रारूप में नहीं है, इसलिए फ़ॉर्म या रिटर्न नहीं बना।",
      next: "कार्यालय प्रशासक से कार्यालय सेटिंग (दस्तावेज़ पहचान) में नियोक्ता का विवरण भरवाएँ, फिर प्रयास करें।",
    },
    actions: ["back", "help"],
  },
  // GAP-FINANCE-JOURNAL-ENTRY-06: finance-service POST /v1/finance/journals answers
  // 409 DUPLICATE_VOUCHER when a hand-typed voucher number is already used in the tenant.
  DUPLICATE_VOUCHER: {
    en: {
      what: "This voucher number is already in use.",
      next: "Enter a different number, or leave it blank to auto-number.",
    },
    hi: {
      what: "यह वाउचर नंबर पहले से इस्तेमाल में है।",
      next: "कोई अलग नंबर दर्ज करें, या खाली छोड़ दें ताकि नंबर अपने-आप बन जाए।",
    },
    actions: ["retry", "help"],
  },
  // GAP-TENANT-ADMIN-USERS-07: identity-service POST /identity/users answers
  // 409 DUPLICATE_EMAIL when the email is already in the tenant's directory.
  DUPLICATE_EMAIL: {
    en: {
      what: "A user with this email already exists.",
      next: "Use a different email address, or open the existing user instead.",
    },
    hi: {
      what: "इस ईमेल वाला उपयोगकर्ता पहले से मौजूद है।",
      next: "कोई दूसरा ईमेल पता इस्तेमाल करें, या मौजूदा उपयोगकर्ता खोलें।",
    },
    actions: ["retry", "help"],
  },
  // GAP-TENANT-ADMIN-ROLES-06: policy-service answers 409 ROLE_NAME_TAKEN when a role
  // is created or renamed onto a name already used in the tenant (any letter case).
  ROLE_NAME_TAKEN: {
    en: {
      what: "A role with this name already exists.",
      next: "Choose a different name, or open the existing role instead.",
    },
    hi: {
      what: "इस नाम की भूमिका पहले से मौजूद है।",
      next: "कोई दूसरा नाम चुनें, या मौजूदा भूमिका खोलें।",
    },
    actions: ["retry", "help"],
  },
  // GAP-TENANT-ADMIN-USERS-DETAIL-06: identity-service limits password-reset requests
  // per user (429 RESET_RECENTLY_REQUESTED) so one account cannot be mail-bombed.
  RESET_RECENTLY_REQUESTED: {
    en: {
      what: "A password reset was already requested for this user a moment ago.",
      next: "Ask them to check their email, or wait a few minutes before sending another.",
    },
    hi: {
      what: "इस उपयोगकर्ता के लिए अभी कुछ देर पहले ही पासवर्ड रीसेट का अनुरोध किया जा चुका है।",
      next: "उनसे अपना ईमेल देखने को कहें, या दूसरा भेजने से पहले कुछ मिनट प्रतीक्षा करें।",
    },
    actions: ["back", "help"],
    serverSide: true,
  },
  // GAP-TENANT-ADMIN-SETTINGS-07: admin-service tenant module toggle answers
  // 404 MODULE_NOT_PROVISIONED for a module the tenant does not hold.
  MODULE_NOT_PROVISIONED: {
    en: {
      what: "This module is not part of your office's setup.",
      next: "Ask your platform administrator to add it, then try again.",
    },
    hi: {
      what: "यह मॉड्यूल आपके कार्यालय की व्यवस्था में शामिल नहीं है।",
      next: "अपने प्लेटफ़ॉर्म प्रशासक से इसे जुड़वाएँ, फिर प्रयास करें।",
    },
    actions: ["back", "help"],
  },
  // GAP-WORKS-CONTRACTORS-DETAIL-04: works-service answers 409 RATING_COOLDOWN when the same officer rates the same
  // contractor again inside the configured waiting period.
  RATING_COOLDOWN: {
    en: {
      what: "You rated this contractor recently.",
      next: "You can rate it again once the waiting period after your last rating has ended.",
    },
    hi: {
      what: "आपने हाल ही में इस ठेकेदार को रेटिंग दी है।",
      next: "आपकी पिछली रेटिंग के बाद की प्रतीक्षा अवधि समाप्त होने पर आप दोबारा रेटिंग दे सकते हैं।",
    },
    actions: ["back", "help"],
  },
  // BR-015 (works-service): once tender details exist for a work its BoQ is frozen against add, edit and delete.
  BOQ_FROZEN: {
    en: {
      what: "The bill of quantities for this work can't be changed any more.",
      next: "Tender details already exist for it. Ask your administrator if a correction is needed.",
    },
    hi: {
      what: "इस कार्य की मात्रा-सूची (BoQ) अब बदली नहीं जा सकती।",
      next: "इसके लिए निविदा विवरण पहले से मौजूद हैं। सुधार की ज़रूरत हो तो अपने प्रशासक से पूछें।",
    },
    actions: ["back", "help"],
  },
};

/**
 * Any other DUPLICATE_* code the services emit (DUPLICATE_PAN, DUPLICATE_BILL,
 * DUPLICATE_REGISTRATION, ... -- ~40 verified in services/*) is a duplicate-record
 * conflict, so it reads as one rather than as "changed by someone else". Specific
 * entries in DOMAIN_CODE_MESSAGES (DUPLICATE_CODE) still win.
 */
const DUPLICATE_RECORD: { en: Entry; hi: Entry } = {
  en: {
    what: "A {object} with these details already exists.",
    next: "Check the existing record, or change the details and try again.",
  },
  hi: {
    what: "इन विवरणों वाला {object} पहले से मौजूद है।",
    next: "मौजूदा रिकॉर्ड देखें, या विवरण बदलकर फिर प्रयास करें।",
  },
};

/** Codes that mean "already exists" without the DUPLICATE_ prefix (shift name, transfer order number). */
const DUPLICATE_LIKE_CODES = new Set(["SHIFT_NAME_EXISTS", "ORDER_NO_EXISTS"]);

/** Exported for the parity test. */
export const DUPLICATE_RECORD_MESSAGE = DUPLICATE_RECORD;

export type ResolvedHumanError = {
  kind: ErrorStatusKind | "domain";
  /** Where the copy came from: a domain code, a service code (its own entry or its family), or the status. */
  source?: "domain" | "serviceCode" | "codeFamily" | "status";
  what: string;
  next: string;
  actions: StandardAction[];
};

/** HTTP status -> kind. `undefined` (no response at all) is a network failure. */
export function statusToKind(status: number | undefined): ErrorStatusKind {
  if (status === undefined || status === 0) return "network";
  if (status === 400 || status === 422) return "validation";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 412) return "concurrentEdit";
  if (status === 409) return "conflict";
  if (status === 413) return "tooLarge";
  if (status === 415) return "unsupportedType";
  if (status === 429) return "rateLimited";
  // A gateway / request timeout is the server being slow, not the user's connection.
  if (status === 408 || status === 504) return "timeout";
  // Any other status (5xx, an unexpected 4xx) is told to the user as "a problem on our side".
  return "server";
}

function actionsFor(kind: ErrorStatusKind): StandardAction[] {
  switch (kind) {
    case "unauthenticated":
      return ["signin"];
    case "forbidden":
      return ["back", "help"];
    case "validation":
    case "tooLarge":
    case "unsupportedType":
      return ["help"];
    case "notFound":
      return ["back", "help"];
    case "conflict":
    case "concurrentEdit":
      return ["retry", "help"];
    default:
      return ["retry", "help"];
  }
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? "");
}

/** Locale for non-hook callers: the `locale` cookie in the browser, English elsewhere. */
export function getClientLocale(): ErrorLocale {
  try {
    if (typeof document !== "undefined") {
      const m = /(?:^|;\s*)locale=([^;]+)/.exec(document.cookie);
      if (m?.[1] === "hi") return "hi";
    }
  } catch {
    // cookie access blocked -> English
  }
  return "en";
}

/**
 * Resolve the standard message. Precedence: a known domain `code` first, then
 * the HTTP status (no status = network failure). Never reads or echoes the
 * backend `message`, the code, or the status number.
 */
export function resolveHumanError(input: {
  status?: number;
  code?: string | null;
  ctx?: ErrorContext;
  /** Force a kind (e.g. "network" for a thrown fetch). */
  forceKind?: ErrorStatusKind;
}): ResolvedHumanError {
  const ctx = input.ctx ?? {};
  const locale: ErrorLocale = ctx.locale ?? getClientLocale();
  const cat = ERROR_CATALOGUE[locale];
  const intent: ErrorIntent = ctx.intent ?? "save";

  // 5xx / 408 / 429 / 401: the status copy wins; a code never turns a server failure into a user-fault message.
  const authoritative = isStatusAuthoritative(input.status);
  const domainEntry = input.code && Object.prototype.hasOwnProperty.call(DOMAIN_CODE_MESSAGES, input.code)
    ? DOMAIN_CODE_MESSAGES[input.code]
    : undefined;
  const domain = domainEntry && (!authoritative || domainEntry.serverSide) ? domainEntry : undefined;
  if (domain) {
    const e = domain[locale];
    return { kind: "domain", source: "domain", what: e.what, next: e.next, actions: domain.actions ?? ["retry", "help"] };
  }

  // Service error codes (serviceErrorCodes.ts): an explicit entry always wins; a naming
  // family wins over the bare status unless the caller pinned the situation (forceKind).
  const svc = resolveServiceCode(input.code, { hasFieldErrors: ctx.hasFieldErrors, status: input.status });
  const svcVars = (object?: { en: string; hi: string }) => ({
    object: ctx.area?.trim() || object?.[locale] || cat.defaultObject,
    verb: cat.verbs[intent],
    limit: ctx.limit?.trim() || cat.defaultLimit,
    types: ctx.types?.trim() || cat.defaultTypes,
  });
  if (svc && svc.source === "explicit") {
    const e = svc.message[locale];
    return { kind: "domain", source: "serviceCode", what: fill(e.what, svcVars()), next: fill(e.next, svcVars()), actions: svc.message.actions ?? ["retry", "help"] };
  }
  if (svc && !input.forceKind && "message" in svc) {
    const e = svc.message[locale];
    const v = svcVars(svc.object);
    return { kind: "domain", source: "codeFamily", what: fill(e.what, v), next: fill(e.next, v), actions: svc.message.actions ?? ["retry", "help"] };
  }
  const familyKind = svc && !input.forceKind && "kind" in svc ? svc.kind : undefined;
  const familyObject = svc && "object" in svc ? svc.object : undefined;

  const kind = input.forceKind ?? familyKind ?? statusToKind(input.status);
  const entry = cat.kinds[kind];
  const vars = {
    object: ctx.area?.trim() || familyObject?.[locale] || ((kind === "conflict" || kind === "concurrentEdit") ? (locale === "hi" ? "रिकॉर्ड" : "record") : cat.defaultObject),
    verb: cat.verbs[intent],
    limit: ctx.limit?.trim() || cat.defaultLimit,
    types: ctx.types?.trim() || cat.defaultTypes,
  };
  if (!authoritative && input.code && (input.code.startsWith("DUPLICATE_") || DUPLICATE_LIKE_CODES.has(input.code) || (svc && "duplicate" in svc))) {
    const d = DUPLICATE_RECORD[locale];
    // "A record with these details already exists" -- never "A information ...".
    const dv = { ...vars, object: ctx.area?.trim() || (locale === "hi" ? "रिकॉर्ड" : "record") };
    return { kind: "domain", source: "codeFamily", what: fill(d.what, dv), next: fill(d.next, dv), actions: ["back", "help"] };
  }
  const neutral = kind === "validation" && !ctx.hasFieldErrors && entry.neutral;
  if (neutral) {
    return { kind, source: familyKind ? "codeFamily" : "status", what: fill(neutral.what, vars), next: fill(neutral.next, vars), actions: actionsFor(kind) };
  }
  const useRead = (kind === "server" || kind === "unknown" || kind === "timeout") && intent === "load" && entry.nextRead;
  return {
    kind,
    source: familyKind ? "codeFamily" : "status",
    what: fill(entry.what, vars),
    next: fill(useRead ? (entry.nextRead as string) : entry.next, vars),
    actions: actionsFor(kind),
  };
}

/** "Reference: ABC123" (localised), or "" when there is no reference. */
export function formatReference(reference: string | null | undefined, locale?: ErrorLocale): string {
  const ref = reference?.trim();
  if (!ref) return "";
  return `${ERROR_CATALOGUE[locale ?? getClientLocale()].referenceLabel}: ${ref}`;
}

/** The support reference a failed response carries (headers only; never shown as the message). */
export function referenceFromHeaders(headers: Pick<Headers, "get"> | undefined): string | null {
  if (!headers) return null;
  const raw = headers.get("x-correlation-id") ?? headers.get("x-request-id");
  const ref = raw?.trim();
  // Only short opaque ids; anything else could be text we do not want on screen.
  return ref && /^[A-Za-z0-9._-]{4,64}$/.test(ref) ? ref : null;
}
