/**
 * UAT post-b14 (GIGW 3.0): the GIGW pages that were still 404.
 *
 * Every string is a gigw.* i18n key (en + hi). A section with neither
 * paragraphs nor links is department-specific: it renders the marked
 * "[Content to be supplied by the department]" placeholder
 * (data-deferred-content), never invented text. Paragraphs are standard
 * GIGW-style wording that is accurate for any department.
 */
export type GigwSlug =
  | "sitemap" | "about" | "contact-us" | "help-desk" | "feedback"
  | "privacy-policy" | "terms-and-conditions" | "hyperlink-policy" | "copyright-policy" | "disclaimer";

export interface GigwLinkSpec { href: string; label: string }
export interface GigwSectionSpec { id: string; heading: string; paras?: string[]; links?: GigwLinkSpec[] }
export interface GigwPageSpec {
  title: string;
  intro?: string;
  /** "pending": the page is owner content; "standard": standard wording, department sections marked; null: factual. */
  notice: "pending" | "standard" | null;
  sections: GigwSectionSpec[];
}

/** Public GIGW pages, in the order the sitemap and the site footer list them. */
export const GIGW_PAGE_LINKS: GigwLinkSpec[] = [
  { href: "/about", label: "aboutTitle" },
  { href: "/contact-us", label: "contactUsTitle" },
  { href: "/help-desk", label: "helpDeskTitle" },
  { href: "/feedback", label: "feedbackTitle" },
  { href: "/accessibility-statement", label: "accessibilityTitle" },
  { href: "/screen-reader-access", label: "screenReaderTitle" },
  { href: "/website-policies", label: "policiesTitle" },
  { href: "/privacy-policy", label: "privacyHeading" },
  { href: "/terms-and-conditions", label: "termsHeading" },
  { href: "/hyperlink-policy", label: "hyperlinkHeading" },
  { href: "/copyright-policy", label: "copyrightHeading" },
  { href: "/disclaimer", label: "disclaimerHeading" },
  { href: "/sitemap", label: "sitemapTitle" },
];

const externalLinks: GigwSectionSpec = { id: "external-links", heading: "externalLinksHeading", paras: ["externalLinksBody"] };
const accuracy: GigwSectionSpec = { id: "accuracy", heading: "accuracyHeading", paras: ["accuracyBody"] };
const liability: GigwSectionSpec = { id: "liability", heading: "liabilityHeading", paras: ["liabilityBody"] };

export const GIGW_PAGE_SPECS: Record<GigwSlug, GigwPageSpec> = {
  sitemap: {
    title: "sitemapTitle",
    intro: "sitemapIntro",
    notice: null,
    sections: [
      { id: "general", heading: "sitemapGeneralHeading", links: [{ href: "/", label: "homeLink" }, { href: "/auth/login", label: "signInLink" }] },
      { id: "information", heading: "sitemapInfoHeading", links: GIGW_PAGE_LINKS.filter((l) => l.href !== "/sitemap") },
    ],
  },
  about: {
    title: "aboutTitle",
    notice: "pending",
    sections: [
      { id: "department", heading: "aboutDepartmentHeading" },
      { id: "vision", heading: "aboutVisionHeading" },
      { id: "functions", heading: "aboutFunctionsHeading" },
      { id: "organisation", heading: "aboutOrganisationHeading" },
      { id: "application", heading: "aboutApplicationHeading", paras: ["aboutApplicationBody"] },
    ],
  },
  "contact-us": {
    title: "contactUsTitle",
    intro: "contactUsIntro",
    notice: "pending",
    sections: [
      { id: "officers", heading: "contactUsOfficersHeading" },
      { id: "address", heading: "contactUsAddressHeading" },
      { id: "web-information-manager", heading: "contactUsWimHeading" },
      { id: "help", heading: "contactUsHelpHeading", paras: ["contactUsHelpBody"], links: [{ href: "/help-desk", label: "helpDeskTitle" }, { href: "/feedback", label: "feedbackTitle" }] },
    ],
  },
  "help-desk": {
    title: "helpDeskTitle",
    intro: "helpDeskIntro",
    notice: "standard",
    sections: [
      { id: "online", heading: "helpDeskOnlineHeading", paras: ["helpDeskOnlineBody"], links: [{ href: "/help", label: "helpDeskOnlineLink" }] },
      { id: "contact", heading: "helpDeskContactHeading" },
      { id: "accessibility", heading: "helpDeskAccessibilityHeading", paras: ["helpDeskAccessibilityBody"], links: [{ href: "/accessibility-statement", label: "accessibilityTitle" }, { href: "/screen-reader-access", label: "screenReaderTitle" }] },
    ],
  },
  feedback: {
    title: "feedbackTitle",
    intro: "feedbackIntro",
    notice: "standard",
    sections: [
      { id: "how", heading: "feedbackHowHeading" },
      { id: "include", heading: "feedbackIncludeHeading", paras: ["feedbackIncludeBody", "feedbackSensitiveBody"] },
      { id: "response", heading: "feedbackResponseHeading" },
    ],
  },
  "privacy-policy": {
    title: "privacyHeading",
    notice: "standard",
    sections: [
      { id: "personal-information", heading: "privacyCollectHeading", paras: ["privacyCollectBody"] },
      { id: "use", heading: "privacyUseHeading", paras: ["privacyUseBody"] },
      { id: "technical", heading: "privacyTechHeading", paras: ["privacyTechBody"] },
      { id: "cookies", heading: "privacyCookiesHeading", paras: ["privacyCookiesBody"] },
      { id: "privacy-contact", heading: "privacyContactHeading" },
    ],
  },
  "terms-and-conditions": {
    title: "termsHeading",
    notice: "standard",
    sections: [
      { id: "use", heading: "termsUseHeading", paras: ["termsUseBody"] },
      accuracy,
      liability,
      externalLinks,
      { id: "governing-law", heading: "governingLawHeading", paras: ["governingLawBody"] },
      { id: "changes", heading: "termsChangesHeading", paras: ["termsChangesBody"] },
    ],
  },
  "hyperlink-policy": {
    title: "hyperlinkHeading",
    notice: "standard",
    sections: [
      externalLinks,
      { id: "linking-in", heading: "linkingInHeading", paras: ["linkingInBody", "framesBody"] },
      { id: "notify", heading: "linkingNotifyHeading" },
    ],
  },
  "copyright-policy": {
    title: "copyrightHeading",
    notice: "standard",
    sections: [
      { id: "reproduction", heading: "copyrightReproduceHeading", paras: ["copyrightReproduceBody"] },
      { id: "third-party", heading: "copyrightThirdHeading", paras: ["copyrightThirdBody"] },
      { id: "permission", heading: "copyrightPermissionHeading" },
    ],
  },
  disclaimer: {
    title: "disclaimerHeading",
    notice: "standard",
    sections: [
      accuracy,
      liability,
      externalLinks,
      { id: "errors", heading: "disclaimerErrorHeading", paras: ["disclaimerErrorBody"], links: [{ href: "/feedback", label: "feedbackTitle" }] },
    ],
  },
};
