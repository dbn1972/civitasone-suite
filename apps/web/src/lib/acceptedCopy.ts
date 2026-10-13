/**
 * Copy for the shared 202 "accepted" notice (SF-15), in en and hi.
 *
 * The same strings live in `messages/{en,hi}.json` under `asyncAccepted` (for
 * callers that already render inside a NextIntlClientProvider and want to pass
 * `labels`). This module exists because the notice is used by many existing
 * client components that are rendered without a provider in their unit tests;
 * it resolves the locale the same way `errorCatalogue` does
 * (`getClientLocale`). `acceptedCopy.parity.test.ts` keeps the two in sync.
 */
import { getClientLocale } from "./errorCatalogue";

export interface AcceptedCopy {
  submitting: string;
  accepted: string;
  pending: string;
  refresh: string;
  refreshedHint: string;
  confirmed: string;
  timedOut: string;
  failed: string;
  dismiss: string;
  /** For forms that leave the page after a 202: the explicit "go on" action that replaces a timed redirect. */
  continue: string;
}

export const ACCEPTED_COPY: Record<"en" | "hi", AcceptedCopy> = {
  en: {
    submitting: "Submitting…",
    accepted: "Received. Your change is being applied and will appear shortly.",
    pending: "Received. Updating…",
    refresh: "Refresh now",
    refreshedHint: "Refreshed. If you do not see the change yet, it is still being applied. Try again in a moment.",
    confirmed: "Done. The change is now showing.",
    timedOut: "Still processing. Your change was received but is not showing yet. Refresh to check again.",
    failed: "Could not submit. Nothing was changed.",
    dismiss: "Dismiss",
    continue: "Continue",
  },
  hi: {
    submitting: "जमा किया जा रहा है…",
    accepted: "प्राप्त हुआ। आपका परिवर्तन लागू हो रहा है और कुछ ही समय में दिखाई देगा।",
    pending: "प्राप्त हुआ। अपडेट हो रहा है…",
    refresh: "अभी रिफ़्रेश करें",
    refreshedHint: "रिफ़्रेश हो गया। यदि परिवर्तन अभी नहीं दिखता, तो वह अभी लागू हो रहा है। कुछ क्षण बाद फिर देखें।",
    confirmed: "पूर्ण। परिवर्तन अब दिखाई दे रहा है।",
    timedOut: "अभी प्रक्रिया जारी है। आपका परिवर्तन प्राप्त हो गया है पर अभी नहीं दिख रहा। फिर से जाँचने के लिए रिफ़्रेश करें।",
    failed: "जमा नहीं हो सका। कुछ भी नहीं बदला।",
    dismiss: "हटाएं",
    continue: "आगे बढ़ें",
  },
};

export function acceptedCopy(): AcceptedCopy {
  return ACCEPTED_COPY[getClientLocale()];
}
