/**
 * GIGW 3.0 public pages: content specification (UAT gigw-content).
 *
 * Every string is a gigw.* i18n key (en + hi). Paragraphs may use
 * {department}, which the renderer fills from NEXT_PUBLIC_GIGW_OWNER (or the
 * demonstration default). Department contact details come from config
 * (lib/gigw/departmentConfig.ts) through "contact" blocks; nothing on these
 * pages is an invented name, address, telephone number or e-mail address.
 *
 * Structure rules, enforced by the tests: one h1 (the title), every section
 * an h2, sub-sections (h3 blocks) only inside a section.
 */
import type { GigwConfigField } from "@/lib/gigw/departmentConfig";

export type GigwSlug =
  | "sitemap" | "about" | "contact-us" | "help-desk" | "feedback"
  | "accessibility-statement" | "screen-reader-access" | "website-policies"
  | "privacy-policy" | "terms-and-conditions" | "hyperlink-policy" | "copyright-policy" | "disclaimer"
  | "content-contribution-policy" | "content-archival-policy" | "content-review-policy";

export interface GigwLinkSpec { href: string; label: string }

export type GigwBlock =
  | { p: string }
  | { ul: string[] }
  | { ol: string[] }
  | { links: GigwLinkSpec[] }
  | { contact: GigwConfigField[] }
  | { readers: true }
  | { h3: string; blocks: GigwBlock[] };

export interface GigwSectionSpec { id: string; heading: string; blocks: GigwBlock[] }
export interface GigwPageSpec { title: string; intro?: string; sections: GigwSectionSpec[] }

const L = {
  about: { href: "/about", label: "aboutTitle" },
  contactUs: { href: "/contact-us", label: "contactUsTitle" },
  helpDesk: { href: "/help-desk", label: "helpDeskTitle" },
  feedback: { href: "/feedback", label: "feedbackTitle" },
  accessibility: { href: "/accessibility-statement", label: "accessibilityTitle" },
  screenReader: { href: "/screen-reader-access", label: "screenReaderTitle" },
  policies: { href: "/website-policies", label: "policiesTitle" },
  privacy: { href: "/privacy-policy", label: "privacyHeading" },
  terms: { href: "/terms-and-conditions", label: "termsHeading" },
  hyperlink: { href: "/hyperlink-policy", label: "hyperlinkHeading" },
  copyright: { href: "/copyright-policy", label: "copyrightHeading" },
  disclaimer: { href: "/disclaimer", label: "disclaimerHeading" },
  cmap: { href: "/content-contribution-policy", label: "cmapTitle" },
  archival: { href: "/content-archival-policy", label: "archivalHeading" },
  review: { href: "/content-review-policy", label: "reviewTitle" },
  sitemap: { href: "/sitemap", label: "sitemapTitle" },
} satisfies Record<string, GigwLinkSpec>;

const INFO_LINKS = [L.about, L.contactUs, L.helpDesk, L.feedback];
const ACCESS_LINKS = [L.accessibility, L.screenReader];
const POLICY_LINKS = [L.policies, L.privacy, L.terms, L.hyperlink, L.copyright, L.disclaimer, L.cmap, L.archival, L.review];

/** Public GIGW pages, in the order the sitemap and the site footer list them. */
export const GIGW_PAGE_LINKS: GigwLinkSpec[] = [...INFO_LINKS, ...ACCESS_LINKS, ...POLICY_LINKS, L.sitemap];

/** Screen readers: product names are not translated (rendered lang="en"). */
export const SCREEN_READERS = [
  { id: "nvda", name: "NVDA (NonVisual Desktop Access)", description: "srNvda", kind: "srFree" },
  { id: "jaws", name: "JAWS (Job Access With Speech)", description: "srJaws", kind: "srCommercial" },
  { id: "narrator", name: "Windows Narrator", description: "srNarrator", kind: "srBuiltIn" },
  { id: "voiceover", name: "VoiceOver", description: "srVoiceover", kind: "srBuiltIn" },
  { id: "talkback", name: "TalkBack", description: "srTalkback", kind: "srBuiltIn" },
  { id: "orca", name: "Orca", description: "srOrca", kind: "srFree" },
  { id: "chromevox", name: "ChromeVox", description: "srChromevox", kind: "srBuiltIn" },
  { id: "supernova", name: "Dolphin SuperNova", description: "srSupernova", kind: "srCommercial" },
  { id: "safa", name: "SAFA", description: "srSafa", kind: "srFree" },
] as const;

const accuracy: GigwSectionSpec = { id: "accuracy", heading: "accuracyHeading", blocks: [{ p: "accuracyBody" }] };
const liability: GigwSectionSpec = { id: "liability", heading: "liabilityHeading", blocks: [{ p: "liabilityBody" }] };
const externalLinks: GigwSectionSpec = { id: "external-links", heading: "externalLinksHeading", blocks: [{ p: "externalLinksBody" }] };

export const GIGW_PAGE_SPECS: Record<GigwSlug, GigwPageSpec> = {
  sitemap: {
    title: "sitemapTitle",
    intro: "sitemapIntro",
    sections: [
      { id: "general", heading: "sitemapGeneralHeading", blocks: [{ links: [{ href: "/", label: "homeLink" }, { href: "/auth/login", label: "signInLink" }] }] },
      { id: "information", heading: "sitemapInfoHeading", blocks: [{ links: INFO_LINKS }] },
      { id: "accessibility", heading: "sitemapAccessHeading", blocks: [{ links: ACCESS_LINKS }] },
      { id: "policies", heading: "sitemapPoliciesHeading", blocks: [{ links: POLICY_LINKS }] },
    ],
  },
  about: {
    title: "aboutTitle",
    intro: "aboutIntro",
    sections: [
      { id: "department", heading: "aboutDepartmentHeading", blocks: [{ p: "aboutDepartmentBody" }] },
      { id: "civitasone", heading: "aboutPortalHeading", blocks: [{ p: "aboutPortalBody" }] },
      { id: "functions", heading: "aboutFunctionsHeading", blocks: [{ p: "aboutFunctionsIntro" }, { ul: ["aboutFn1", "aboutFn2", "aboutFn3", "aboutFn4", "aboutFn5", "aboutFn6"] }] },
      { id: "commitments", heading: "aboutCommitHeading", blocks: [{ ul: ["aboutCommit1", "aboutCommit2", "aboutCommit3", "aboutCommit4"] }] },
      { id: "contact", heading: "aboutContactHeading", blocks: [{ p: "aboutContactBody" }, { links: [L.contactUs] }] },
    ],
  },
  "contact-us": {
    title: "contactUsTitle",
    intro: "contactUsIntro",
    sections: [
      { id: "department", heading: "contactDeptHeading", blocks: [{ contact: ["department", "address"] }] },
      { id: "web-information-manager", heading: "contactWimHeading", blocks: [{ p: "contactWimBody" }, { contact: ["wimDesignation", "wimEmail", "wimPhone"] }] },
      { id: "help-desk", heading: "contactHelpHeading", blocks: [{ p: "contactHelpBody" }, { contact: ["helpdeskEmail", "helpdeskPhone", "helpdeskHours"] }, { links: [L.helpDesk, L.feedback] }] },
      { id: "rti", heading: "contactRtiHeading", blocks: [{ p: "contactRtiBody" }, { contact: ["pioContact", "faaContact"] }] },
      { id: "grievances", heading: "contactGrievanceHeading", blocks: [{ p: "contactGrievanceBody" }] },
      { id: "before-writing", heading: "contactNotesHeading", blocks: [{ ul: ["contactNote1", "contactNote2", "contactNote3"] }] },
    ],
  },
  "help-desk": {
    title: "helpDeskTitle",
    intro: "helpDeskIntro",
    sections: [
      { id: "sign-in", heading: "helpSignInHeading", blocks: [{ ul: ["helpSignIn1", "helpSignIn2", "helpSignIn3", "helpSignIn4"] }] },
      { id: "online", heading: "helpDeskOnlineHeading", blocks: [{ p: "helpDeskOnlineBody" }, { links: [{ href: "/help", label: "helpDeskOnlineLink" }] }] },
      { id: "navigation", heading: "helpNavHeading", blocks: [{ ul: ["helpNav1", "helpNav2", "helpNav3", "helpNav4"] }, { links: [L.sitemap] }] },
      { id: "files", heading: "helpFilesHeading", blocks: [{ p: "helpFilesBody" }, { ul: ["helpFile1", "helpFile2", "helpFile3"] }] },
      { id: "contact", heading: "helpDeskContactHeading", blocks: [{ contact: ["helpdeskEmail", "helpdeskPhone", "helpdeskHours"] }, { p: "helpDeskContactBody" }] },
      { id: "accessibility", heading: "helpDeskAccessibilityHeading", blocks: [{ p: "helpDeskAccessibilityBody" }, { links: [L.accessibility, L.screenReader, L.feedback] }] },
    ],
  },
  feedback: {
    title: "feedbackTitle",
    intro: "feedbackIntro",
    sections: [
      { id: "how", heading: "feedbackHowHeading", blocks: [{ p: "feedbackHowBody" }, { contact: ["wimDesignation", "wimEmail"] }, { p: "feedbackHowBody2" }, { links: [L.contactUs] }] },
      { id: "include", heading: "feedbackIncludeHeading", blocks: [{ ul: ["feedbackInclude1", "feedbackInclude2", "feedbackInclude3", "feedbackInclude4"] }, { p: "feedbackSensitiveBody" }] },
      { id: "response", heading: "feedbackResponseHeading", blocks: [{ p: "feedbackResponseBody" }] },
      { id: "not-for", heading: "feedbackNotHeading", blocks: [{ p: "feedbackNotBody" }] },
    ],
  },
  "accessibility-statement": {
    title: "accessibilityTitle",
    intro: "accessibilityIntro",
    sections: [
      { id: "conformance", heading: "conformanceHeading", blocks: [{ p: "conformanceBody" }, { p: "conformanceBody2" }] },
      { id: "features", heading: "featuresHeading", blocks: [{ ul: ["feature1", "feature2", "feature3", "feature4", "feature5", "feature6", "feature7", "feature8"] }] },
      { id: "known-issues", heading: "knownIssuesHeading", blocks: [{ p: "knownIssuesBody" }, { ul: ["known1", "known2", "known3", "known4", "known5", "known6", "known7", "known8", "known9"] }] },
      { id: "improvement-plan", heading: "planHeading", blocks: [{ ul: ["plan1", "plan2", "plan3", "plan4"] }] },
      { id: "assistive-technology", heading: "assistiveHeading", blocks: [{ p: "assistiveBody" }, { links: [L.screenReader] }] },
      { id: "feedback", heading: "feedbackHeading", blocks: [{ p: "accFeedbackBody" }, { contact: ["wimDesignation", "wimEmail", "wimPhone"] }, { links: [L.feedback] }] },
      { id: "enforcement", heading: "enforcementHeading", blocks: [{ p: "enforcementBody" }] },
      { id: "statement-date", heading: "statementDateHeading", blocks: [{ p: "statementDateBody" }] },
    ],
  },
  "screen-reader-access": {
    title: "screenReaderTitle",
    intro: "screenReaderIntro",
    sections: [
      { id: "screen-readers", heading: "srListHeading", blocks: [{ readers: true }] },
      { id: "tips", heading: "srTipsHeading", blocks: [{ ul: ["srTip1", "srTip2", "srTip3", "srTip4"] }] },
      { id: "indian-languages", heading: "srIndianHeading", blocks: [{ p: "srIndianBody" }] },
      { id: "problems", heading: "srProblemHeading", blocks: [{ p: "srProblemBody" }, { links: [L.feedback, L.accessibility] }] },
    ],
  },
  "website-policies": {
    title: "policiesTitle",
    intro: "policiesIntro",
    sections: [
      { id: "copyright", heading: "copyrightHeading", blocks: [{ p: "polCopyright" }, { links: [{ href: L.copyright.href, label: "polCopyrightLink" }] }] },
      { id: "hyperlinking", heading: "hyperlinkHeading", blocks: [{ p: "polHyperlink" }, { links: [{ href: L.hyperlink.href, label: "polHyperlinkLink" }] }] },
      { id: "privacy", heading: "privacyHeading", blocks: [{ p: "polPrivacy" }, { links: [{ href: L.privacy.href, label: "polPrivacyLink" }] }] },
      { id: "terms", heading: "termsHeading", blocks: [{ p: "polTerms" }, { links: [{ href: L.terms.href, label: "polTermsLink" }] }] },
      { id: "disclaimer", heading: "disclaimerHeading", blocks: [{ p: "polDisclaimer" }, { links: [{ href: L.disclaimer.href, label: "polDisclaimerLink" }] }] },
      { id: "cmap", heading: "cmapTitle", blocks: [{ p: "polCmap" }, { links: [{ href: L.cmap.href, label: "polCmapLink" }] }] },
      { id: "archival", heading: "archivalHeading", blocks: [{ p: "polArchival" }, { links: [{ href: L.archival.href, label: "polArchivalLink" }] }] },
      { id: "review", heading: "reviewTitle", blocks: [{ p: "polReview" }, { links: [{ href: L.review.href, label: "polReviewLink" }] }] },
      { id: "accessibility", heading: "accessibilityTitle", blocks: [{ p: "polAccessibility" }, { links: [{ href: L.accessibility.href, label: "polAccessibilityLink" }] }] },
      { id: "security", heading: "polSecurityHeading", blocks: [{ p: "polSecurityBody" }, { ul: ["polSec1", "polSec2", "polSec3", "polSec4", "polSec5"] }] },
      { id: "monitoring", heading: "polMonitorHeading", blocks: [{ p: "polMonitorBody" }] },
      { id: "contingency", heading: "polContingencyHeading", blocks: [{ p: "polContingencyBody" }] },
    ],
  },
  "privacy-policy": {
    title: "privacyHeading",
    intro: "privacyIntro",
    sections: [
      { id: "scope", heading: "privacyScopeHeading", blocks: [{ p: "privacyScopeBody" }] },
      { id: "personal-information", heading: "privacyCollectHeading", blocks: [
        { h3: "privacyVisitorsHeading", blocks: [{ p: "privacyCollectBody" }] },
        { h3: "privacyUsersHeading", blocks: [{ ul: ["privacyUser1", "privacyUser2", "privacyUser3"] }] },
        { h3: "privacyTechHeading", blocks: [{ p: "privacyTechBody" }] },
      ] },
      { id: "cookies", heading: "privacyCookiesHeading", blocks: [
        { p: "privacyCookiesBody" },
        { ul: ["privacyCookie1", "privacyCookie2", "privacyCookie3", "privacyCookie4"] },
        { p: "privacyCookiesNoTrack" },
        { p: "privacyCookiesBody2" },
      ] },
      { id: "maps", heading: "privacyMapsHeading", blocks: [{ p: "privacyMapsBody" }] },
      { id: "use", heading: "privacyUseHeading", blocks: [{ ul: ["privacyUse1", "privacyUse2", "privacyUse3", "privacyUse4"] }] },
      { id: "sharing", heading: "privacyShareHeading", blocks: [{ p: "privacyUseBody" }] },
      { id: "retention", heading: "privacyRetentionHeading", blocks: [{ p: "privacyRetentionBody" }, { p: "privacyRetentionBody2" }] },
      { id: "security", heading: "privacySecurityHeading", blocks: [{ ul: ["privacySec1", "privacySec2", "privacySec3", "privacySec4"] }] },
      { id: "rights", heading: "privacyRightsHeading", blocks: [{ p: "privacyRightsBody" }] },
      { id: "privacy-contact", heading: "privacyContactHeading", blocks: [{ p: "privacyContactBody" }, { contact: ["wimDesignation", "wimEmail"] }, { links: [L.contactUs] }] },
      { id: "changes", heading: "privacyChangesHeading", blocks: [{ p: "privacyChangesBody" }, { links: [L.review] }] },
    ],
  },
  "terms-and-conditions": {
    title: "termsHeading",
    intro: "termsIntro",
    sections: [
      { id: "ownership", heading: "termsOwnerHeading", blocks: [{ p: "termsOwnerBody" }] },
      { id: "use", heading: "termsUseHeading", blocks: [{ p: "termsUseBody" }, { ul: ["termsUse1", "termsUse2", "termsUse3", "termsUse4", "termsUse5"] }] },
      accuracy,
      liability,
      externalLinks,
      { id: "governing-law", heading: "governingLawHeading", blocks: [{ p: "governingLawBody" }] },
      { id: "changes", heading: "termsChangesHeading", blocks: [{ p: "termsChangesBody" }] },
    ],
  },
  "hyperlink-policy": {
    title: "hyperlinkHeading",
    intro: "hyperlinkIntro",
    sections: [
      { id: "external-links", heading: "externalLinksHeading", blocks: [{ p: "externalLinksBody" }, { p: "hyperlinkOutBody2" }] },
      { id: "linking-in", heading: "linkingInHeading", blocks: [{ p: "linkingInBody" }, { p: "framesBody" }, { p: "hyperlinkAppBody" }] },
      { id: "notify", heading: "linkingNotifyHeading", blocks: [{ p: "linkingNotifyBody" }, { contact: ["wimDesignation", "wimEmail"] }] },
    ],
  },
  "copyright-policy": {
    title: "copyrightHeading",
    intro: "copyrightIntro",
    sections: [
      { id: "ownership", heading: "copyrightOwnerHeading", blocks: [{ p: "copyrightOwnerBody" }] },
      { id: "reproduction", heading: "copyrightReproduceHeading", blocks: [{ p: "copyrightReproduceBody" }] },
      { id: "third-party", heading: "copyrightThirdHeading", blocks: [{ p: "copyrightThirdBody" }] },
      { id: "software", heading: "copyrightSoftwareHeading", blocks: [{ p: "copyrightSoftwareBody" }] },
      { id: "permission", heading: "copyrightPermissionHeading", blocks: [{ p: "copyrightPermissionBody" }, { contact: ["wimDesignation", "wimEmail"] }] },
    ],
  },
  disclaimer: {
    title: "disclaimerHeading",
    intro: "disclaimerIntro",
    sections: [
      accuracy,
      { id: "official-records", heading: "disclaimerRecordsHeading", blocks: [{ p: "disclaimerRecordsBody" }] },
      liability,
      externalLinks,
      { id: "availability", heading: "disclaimerAvailHeading", blocks: [{ p: "disclaimerAvailBody" }] },
      { id: "errors", heading: "disclaimerErrorHeading", blocks: [{ p: "disclaimerErrorBody" }, { links: [L.feedback] }] },
    ],
  },
  "content-contribution-policy": {
    title: "cmapTitle",
    intro: "cmapIntro",
    sections: [
      { id: "roles", heading: "cmapRolesHeading", blocks: [{ ul: ["cmapRole1", "cmapRole2", "cmapRole3", "cmapRole4"] }] },
      { id: "process", heading: "cmapProcessHeading", blocks: [{ ol: ["cmapStep1", "cmapStep2", "cmapStep3", "cmapStep4"] }] },
      { id: "standards", heading: "cmapStandardsHeading", blocks: [{ ul: ["cmapStd1", "cmapStd2", "cmapStd3", "cmapStd4"] }] },
      { id: "application-records", heading: "cmapAppHeading", blocks: [{ p: "cmapAppBody" }] },
    ],
  },
  "content-archival-policy": {
    title: "archivalHeading",
    intro: "archivalIntro",
    sections: [
      { id: "scope", heading: "archivalScopeHeading", blocks: [{ p: "archivalScopeBody" }] },
      { id: "content-life", heading: "archivalLifeHeading", blocks: [{ ul: ["archivalLife1", "archivalLife2", "archivalLife3", "archivalLife4"] }] },
      { id: "archived-content", heading: "archivalArchiveHeading", blocks: [{ p: "archivalArchiveBody" }] },
      { id: "official-records", heading: "archivalRecordsHeading", blocks: [{ p: "archivalRecordsBody" }] },
      { id: "responsibility", heading: "archivalRespHeading", blocks: [{ p: "archivalRespBody" }] },
    ],
  },
  "content-review-policy": {
    title: "reviewTitle",
    intro: "reviewIntro",
    sections: [
      { id: "schedule", heading: "reviewScheduleHeading", blocks: [{ ul: ["reviewItem1", "reviewItem2", "reviewItem3", "reviewItem4", "reviewItem5"] }] },
      { id: "who", heading: "reviewWhoHeading", blocks: [{ p: "reviewWhoBody" }, { links: [L.cmap] }] },
      { id: "review-date", heading: "reviewDateHeading", blocks: [{ p: "reviewDateBody" }] },
      { id: "report", heading: "reviewReportHeading", blocks: [{ p: "reviewReportBody" }, { links: [L.feedback] }] },
    ],
  },
};
