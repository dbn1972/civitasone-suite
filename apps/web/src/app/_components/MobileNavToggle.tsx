"use client";

import { useEffect, useCallback, useState } from "react";
import { usePathname } from "next/navigation";

export function MobileNavToggle() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => {
    setOpen(false);
    document.querySelector(".app")?.classList.remove("nav-open");
  }, []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  function toggle() {
    const next = !open;
    setOpen(next);
    document.querySelector(".app")?.classList.toggle("nav-open", next);
  }

  return (
    <>
      <button
        className="mob-menu-btn"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="app-sidebar"
        onClick={toggle}
        type="button"
      >
        {open ? "✕" : "☰"}
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
