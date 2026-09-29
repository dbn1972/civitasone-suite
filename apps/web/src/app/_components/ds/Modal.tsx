"use client";
/**
 * Modal — generic accessible dialog shell.
 *
 * Extracted from ConfirmDialog (gap catalog SF-19): this component owns only
 * the shell/accessibility mechanics --
 *  - document.body portal
 *  - focus moved into the panel on open, trapped (Tab / Shift+Tab cycle),
 *    restored to the trigger on close
 *  - ESC closes
 *  - background siblings made `inert` while open
 *  - role="dialog" (default) or role="alertdialog", aria-modal,
 *    aria-labelledby (title), optional aria-describedby
 *
 * It has no confirm/cancel buttons and no "reason" field -- compose those
 * (or any other body content) via `children`. Use this directly for a form
 * dialog, an info dialog, a wizard step shown as an overlay, etc.
 * `ConfirmDialog` is built on top of this component; see ConfirmDialog.tsx.
 *
 * WCAG 2.2 AA rationale for the two effects that aren't simply "obvious
 * React":
 *  - The Tab-trap below only intercepts the Tab *key*. It does nothing to
 *    stop a screen reader's own browse-mode/virtual-cursor navigation from
 *    wandering into background content, since that never fires a Tab
 *    keydown at all. `inert` removes background content from the
 *    accessibility tree (and the tab order, and hit-testing) at the browser
 *    level instead -- this requires the dialog to be a document.body-level
 *    child, hence the createPortal below.
 *  - ESC/Tab handling lives on a document-level listener rather than a JSX
 *    onKeyDown prop on the panel, so it doesn't trip jsx-a11y's
 *    non-interactive-element-interactions check, and keeps working
 *    regardless of exactly what inside the panel currently has focus.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Heading content, rendered inside an <h2> and wired as aria-labelledby. */
  title: ReactNode;
  children: ReactNode;
  /** Panel max-width. Defaults to "md" (440px, matching ConfirmDialog's original fixed width). */
  size?: ModalSize;
  /**
   * "dialog" (default) for non-blocking content; "alertdialog" for
   * confirmations/warnings that demand an immediate decision.
   */
  role?: "dialog" | "alertdialog";
  /**
   * id of an element rendered by the caller (inside `children`) that
   * describes the dialog. Wired to aria-describedby when present. Modal
   * doesn't own description content itself -- generate the id with useId()
   * in the caller and put it on the element you render as a child.
   */
  describedById?: string;
  /**
   * Whether clicking the overlay (outside the panel) closes the dialog.
   * Default true; pass a computed boolean (e.g. `!busy`) to suppress this
   * while a blocking action is in flight.
   */
  closeOnOverlayClick?: boolean;
  /**
   * Extra class name appended to the overlay element -- a styling/back-compat
   * hook for composition (e.g. ConfirmDialog keeps rendering its historical
   * "cd-overlay" class this way so existing CSS/tests keep matching).
   */
  overlayClassName?: string;
  /** Extra class name appended to the panel element -- see `overlayClassName`. */
  panelClassName?: string;
  /** Extra class name appended to the title <h2> -- see `overlayClassName`. */
  titleClassName?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function joinClassNames(...names: Array<string | undefined | false>): string {
  return names.filter(Boolean).join(" ");
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  role = "dialog",
  describedById,
  closeOnOverlayClick = true,
  overlayClassName,
  panelClassName,
  titleClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Move focus in on open, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const node = panelRef.current;
    if (node) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus();
    }
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Escape + Tab-trap via a document-level listener -- see file header.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const node = panelRef.current;
      if (!node) return;
      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Make everything outside the dialog inert while open -- see file header.
  useEffect(() => {
    if (!open) return;
    const hidden: HTMLElement[] = [];
    Array.from(document.body.children).forEach((child) => {
      if (
        child instanceof HTMLElement &&
        child !== panelRef.current &&
        !child.contains(panelRef.current)
      ) {
        if (!child.hasAttribute("inert")) {
          hidden.push(child);
          child.setAttribute("inert", "");
        }
      }
    });
    return () => {
      hidden.forEach((el) => el.removeAttribute("inert"));
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={joinClassNames("modal-overlay", overlayClassName)}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && closeOnOverlayClick) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={joinClassNames(
          "modal-panel",
          size !== "md" ? `modal-panel--${size}` : undefined,
          panelClassName,
        )}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
      >
        <h2 className={joinClassNames("modal-title", titleClassName)} id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
