"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/app/_components/ds";

/**
 * GAP-GRANTS-APPLICATIONS-02: the real application-stage statuses the list can
 * be filtered by (NOT the old bogus "pending"). Exported so the page validates
 * ?status= against the same source of truth.
 */
export const APPLICATION_FILTERS = ["submitted", "under_review", "approved", "rejected", "withdrawn"] as const;
export type ApplicationFilter = (typeof APPLICATION_FILTERS)[number];

const LABELS: Record<ApplicationFilter, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export function FilterButton({ activeStatus }: { activeStatus: ApplicationFilter | null }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // GAP-GRANTS-APPLICATIONS-04: outside-click closes the menu.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Move focus to the first menu item when opened.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  function apply(status: ApplicationFilter | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (status) params.set("status", status);
    else params.delete("status");
    const qs = params.toString();
    router.push(qs ? `/grants/applications?${qs}` : "/grants/applications");
    setOpen(false);
    triggerRef.current?.focus();
  }

  // GAP-GRANTS-APPLICATIONS-04: Escape closes + returns focus; arrows roam.
  function onMenuKeyDown(e: React.KeyboardEvent, index: number) {
    const count = itemRefs.current.length;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      itemRefs.current[(index + 1) % count]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      itemRefs.current[(index - 1 + count) % count]?.focus();
    }
  }

  // "All" (clear) first, then each real status.
  const items: { key: string; label: string; value: ApplicationFilter | null }[] = [
    { key: "all", label: "All", value: null },
    ...APPLICATION_FILTERS.map((s) => ({ key: s, label: LABELS[s], value: s as ApplicationFilter })),
  ];

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        style={{ minHeight: 44 }}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {activeStatus ? `Filter: ${LABELS[activeStatus]} ▾` : "Filter ▾"}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Filter by status"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            minWidth: 180,
            zIndex: 50,
            padding: "4px 0",
          }}
        >
          {items.map((item, i) => {
            const isActive = item.value === activeStatus;
            return (
              <Button
                key={item.key}
                ref={(el: HTMLButtonElement | null) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                variant="ghost"
                style={{ width: "100%", textAlign: "start", justifyContent: "flex-start", borderRadius: 0, minHeight: 40 }}
                onKeyDown={(e) => onMenuKeyDown(e, i)}
                onClick={() => apply(item.value)}
              >
                {isActive ? "✓ " : ""}
                {item.label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
