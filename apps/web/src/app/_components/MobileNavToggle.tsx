"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

export function MobileNavToggle() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    document.querySelector(".app")?.classList.remove("nav-open");
  }, []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  // UAT-P2-D3 (A11Y-05): while the off-canvas drawer is open, focus moves into
  // it and Escape closes it and returns focus to this button. (When closed the
  // drawer is visibility:hidden at <=768px, so its links leave the Tab order.)
  useEffect(() => {
    if (!open) return;
    const first = document.querySelector<HTMLElement>("#app-sidebar a[href], #app-sidebar button");
    first?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  function toggle() {
    const next = !open;
    setOpen(next);
    document.querySelector(".app")?.classList.toggle("nav-open", next);
  }

  return (
    <>
      <button
        ref={buttonRef}
        className="mob-menu-btn"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="app-sidebar"
        onClick={toggle}
        type="button"
      >
        {open ? <X aria-hidden="true" size={18} /> : <Menu aria-hidden="true" size={18} />}
      </button>
      {open && (
        <div
          className="mob-overlay"
          aria-hidden="true"
          onClick={close}
        />
      )}
    </>
  );
}
