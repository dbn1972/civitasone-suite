"use client";

/**
 * AskCivitasOne: the AI assistant.
 *
 * UAT-P3 (DS-3 / DS-10): the trigger used to be a floating button fixed at the
 * bottom-right of every page. It covered tiles, KPI cards and the last table
 * column (46 overlap hits), and in Hindi it was pushed off-screen at 360 px.
 * The trigger now sits in the top bar (AskCivitasOneTrigger, rendered by
 * TopBar). The panel host (AskCivitasOne) stays mounted once in AppShell,
 * outside the header, and opens on the ASK_OPEN_EVENT the trigger dispatches.
 */
import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { AskCivitasOnePanel } from "./AskCivitasOnePanel";
import { useShellT } from "./useShellT";

export const ASK_OPEN_EVENT = "civitas:ask-open";

/** Header button that opens the assistant panel. */
export function AskCivitasOneTrigger() {
  const t = useShellT("assistant");
  const label = t("title", "Ask CivitasOne");
  return (
    <button
      type="button"
      className="iconbtn tb-ask"
      data-ask-trigger=""
      aria-label={label}
      title={label}
      onClick={() => window.dispatchEvent(new CustomEvent(ASK_OPEN_EVENT))}
    >
      <MessageCircle aria-hidden="true" size={18} />
      <span className="tb-ask-label">{t("trigger", "Ask")}</span>
    </button>
  );
}

/** Panel host: mounted once by AppShell; opens when the header trigger asks. */
export function AskCivitasOne() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener(ASK_OPEN_EVENT, open);
    return () => window.removeEventListener(ASK_OPEN_EVENT, open);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    // Return focus to the control that opened the panel (WCAG 2.4.3).
    // Below 480 px the header trigger is hidden (Ask lives in the Account menu),
    // so fall back to the account button.
    const visible = Array.from(document.querySelectorAll<HTMLElement>("[data-ask-trigger]")).find((el) => el.getClientRects().length > 0);
    (visible ?? document.querySelector<HTMLElement>(".tb-account"))?.focus();
  }, []);

  return isOpen ? <AskCivitasOnePanel onClose={handleClose} /> : null;
}
