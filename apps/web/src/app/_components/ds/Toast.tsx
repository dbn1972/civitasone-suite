"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

// ─── Types ──────────────────────────────────────────────────────────────

type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  removing?: boolean;
}

interface ToastContextValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    warning: (message: string) => void;
  };
}

// ─── Context ────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ─── Styles ─────────────────────────────────────────────────────────────

// Theme tokens (civitas-ds.css), not hardcoded hex: --good/--bad/--info/--warn
// and their *bg pairs are redefined under `.dark` (toggled on <html> by
// DarkModeToggle), so the toast now follows the active theme instead of
// always rendering its light-mode colors. Fallbacks are the current
// light-mode values, in case this ever renders before the stylesheet loads.
const TYPE_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "var(--goodbg, #ecfdf3)", border: "var(--good, #067647)", icon: "✓" },
  error: { bg: "var(--badbg, #fef3f2)", border: "var(--bad, #b42318)", icon: "✕" },
  info: { bg: "var(--infobg, #eff8ff)", border: "var(--info, #175cd3)", icon: "ℹ" },
  warning: { bg: "var(--warnbg, #fffaeb)", border: "var(--warn, #b54708)", icon: "⚠" },
};

const AUTO_DISMISS_MS = 4000;

// ─── Provider ───────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, message }]);

    // Auto-dismiss after 4s
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, removing: true } : t))
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, AUTO_DISMISS_MS);
  }, []);

  const toast = {
    success: (message: string) => addToast("success", message),
    error: (message: string) => addToast("error", message),
    info: (message: string) => addToast("info", message),
    warning: (message: string) => addToast("warning", message),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div
        aria-live="polite"
        aria-relevant="additions"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((item) => {
          const s = TYPE_STYLES[item.type];
          return (
            <div
              key={item.id}
              role="alert"
              style={{
                pointerEvents: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderRadius: 8,
                background: s.bg,
                borderLeft: `4px solid ${s.border}`,
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                fontSize: 14,
                color: "var(--ink, #101828)",
                minWidth: 260,
                maxWidth: 380,
                animation: item.removing
                  ? "slide-out-right 0.3s ease forwards"
                  : "slide-in-right 0.3s ease forwards",
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 16,
                  color: s.border,
                  width: 20,
                  textAlign: "center",
                }}
              >
                {s.icon}
              </span>
              <span style={{ flex: 1 }}>{item.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
