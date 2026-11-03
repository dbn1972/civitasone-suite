"use client";
/**
 * UAT-P2-D3 (A11Y-09, WCAG 2.1.1 / 4.1.2 / 1.4.13): the top-bar Account menu
 * and Notifications popover declare role="menu" but ignored Escape and the
 * arrow keys, never moved focus in, and never gave it back. This hook adds the
 * keyboard contract a menu promises, without changing any markup:
 *   - on open, focus moves to the first focusable item;
 *   - ArrowDown / ArrowUp / Home / End move between the items (wrapping);
 *   - Escape closes and returns focus to the trigger;
 *   - a pointer press outside the trigger and the popup closes it.
 */
import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function menuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute("aria-hidden") !== "true",
  );
}

export function useMenuKeyboard(
  open: boolean,
  close: () => void,
  triggerRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    menuItems(menu)[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (!menu.contains(document.activeElement)) return;
      // Native selects and text inputs keep their own arrow-key behaviour.
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "SELECT" || active.tagName === "INPUT")) return;
      const items = menuItems(menu);
      if (items.length === 0) return;
      const i = items.indexOf(active as HTMLElement);
      let next: HTMLElement | undefined;
      if (e.key === "ArrowDown") next = items[(i + 1) % items.length];
      else if (e.key === "ArrowUp") next = items[(i - 1 + items.length) % items.length];
      else if (e.key === "Home") next = items[0];
      else if (e.key === "End") next = items[items.length - 1];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, close, triggerRef, menuRef]);
}
