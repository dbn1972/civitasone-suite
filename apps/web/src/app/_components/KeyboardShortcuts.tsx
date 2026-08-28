"use client";

/**
 * Global keyboard shortcut system using two-key chords.
 * First key sets mode ("g" for go/navigate, "n" for new/create),
 * second key triggers the action.
 * Press "?" to open the shortcut cheat sheet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShortcutSheet } from "./ShortcutSheet";

export interface Shortcut {
  keys: string;
  label: string;
  category: "Navigation" | "Actions" | "System";
  action: () => void;
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const modeRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shortcuts: Shortcut[] = [
    { keys: "g f", label: "Go to Finance", category: "Navigation", action: () => router.push("/finance") },
    { keys: "g h", label: "Go to HR", category: "Navigation", action: () => router.push("/hr") },
    { keys: "g p", label: "Go to Procurement", category: "Navigation", action: () => router.push("/procurement") },
    { keys: "g a", label: "Go to Assets", category: "Navigation", action: () => router.push("/assets") },
    { keys: "g r", label: "Go to Reports", category: "Navigation", action: () => router.push("/reports") },
    { keys: "n v", label: "New Voucher", category: "Actions", action: () => router.push("/finance/accounting/vouchers/new") },
    { keys: "n l", label: "New Leave Request", category: "Actions", action: () => router.push("/hr/leave/apply") },
    { keys: "?", label: "Show keyboard shortcuts", category: "System", action: () => setSheetOpen(true) },
  ];

  const isInputFocused = useCallback((): boolean => {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in form fields
      if (isInputFocused()) return;

      // Ignore modifier keys
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();

      // Handle "?" shortcut directly
      if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        setSheetOpen(true);
        return;
      }

      // If we're in chord mode, look for the second key
      if (modeRef.current) {
        const chord = `${modeRef.current} ${key}`;
        const match = shortcuts.find((s) => s.keys === chord);
        modeRef.current = null;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (match) {
          e.preventDefault();
          match.action();
        }
        return;
      }

      // Set mode for chord prefixes
      if (key === "g" || key === "n") {
        modeRef.current = key;
        // Clear mode after 1.5s if no second key pressed
        timerRef.current = setTimeout(() => {
          modeRef.current = null;
        }, 1500);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isInputFocused, router]);

  return (
    <ShortcutSheet
      open={sheetOpen}
      onClose={() => setSheetOpen(false)}
      shortcuts={shortcuts}
    />
  );
}
