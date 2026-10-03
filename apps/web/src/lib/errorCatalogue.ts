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

export type ErrorLocale = "en" | "hi";

/** The situations the standard distinguishes. */
export type ErrorStatusKind =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "notFound"
  | "conflict"
  | "tooLarge"
  | "unsupportedType"
  | "rateLimited"
  | "server"
  | "network"
  /** A failure whose cause is not known (a thrown error with no response): honest about both possibilities. */
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
    network: {
      what: "We couldn't connect.",
      next: "Check your internet connection and try again.",
    },
    unknown: {
      what: "We couldn't {verb} the {object}.",
      next: "Your changes haven't been saved. Check your internet connection and try again in a few minutes.",
      nextRead: "Check your internet connection and try again in a few minutes.",
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
    unknown: {
      what: "हम {object} को {verb} सके।",
      next: "आपके बदलाव सहेजे नहीं गए हैं। अपना इंटरनेट कनेक्शन जाँचें और कुछ मिनट बाद फिर प्रयास करें।",
      nextRead: "अपना इंटरनेट कनेक्शन जाँचें और कुछ मिनट बाद फिर प्रयास करें।",
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
export type DomainMessage = { en: Entry; hi: Entry; actions?: StandardAction[] };

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
  // Every "you cannot decide your own request" code the services emit (verified in services/*).
  SELF_APPROVAL_FORBIDDEN: SELF_APPROVAL_MESSAGE,
  SELF_APPROVAL: SELF_APPROVAL_MESSAGE,
  SELF_APPROVAL_DENIED: SELF_APPROVAL_MESSAGE,
  FNF_SELF_APPROVAL_FORBIDDEN: SELF_APPROVAL_MESSAGE,
  // Maker-checker: the approver must be a different person from the maker.
  MAKER_CHECKER: MAKER_CHECKER_MESSAGE,
  MAKER_CHECKER_VIOLATION: MAKER_CHECKER_MESSAGE,
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
  if (status === 409 || status === 412) return "conflict";
  if (status === 413) return "tooLarge";
  if (status === 415) return "unsupportedType";
  if (status === 429) return "rateLimited";
  if (status === 408 || status === 504) return "network";
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

  const domain = input.code && Object.prototype.hasOwnProperty.call(DOMAIN_CODE_MESSAGES, input.code)
    ? DOMAIN_CODE_MESSAGES[input.code]
    : undefined;
  if (domain) {
    const e = domain[locale];
    return { kind: "domain", what: e.what, next: e.next, actions: domain.actions ?? ["retry", "help"] };
  }

  const kind = input.forceKind ?? statusToKind(input.status);
  const entry = cat.kinds[kind];
  const vars = {
    object: ctx.area?.trim() || cat.defaultObject,
    verb: cat.verbs[intent],
    limit: ctx.limit?.trim() || cat.defaultLimit,
    types: ctx.types?.trim() || cat.defaultTypes,
  };
  if (input.code && (input.code.startsWith("DUPLICATE_") || DUPLICATE_LIKE_CODES.has(input.code))) {
    const d = DUPLICATE_RECORD[locale];
    return { kind: "domain", what: fill(d.what, vars), next: fill(d.next, vars), actions: ["back", "help"] };
  }
  const neutral = kind === "validation" && !ctx.hasFieldErrors && entry.neutral;
  if (neutral) {
    return { kind, what: fill(neutral.what, vars), next: fill(neutral.next, vars), actions: actionsFor(kind) };
  }
  const useRead = (kind === "server" || kind === "unknown") && intent === "load" && entry.nextRead;
  return {
    kind,
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
