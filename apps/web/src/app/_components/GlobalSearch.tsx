"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  id: string;
  title: string;
  module: string;
  href: string;
  icon?: string;
}

const MODULES: SearchResult[] = [
  { id: "f1", title: "Budget Dashboard", module: "Finance", href: "/finance/dashboard", icon: "💰" },
  { id: "f2", title: "Budget Formulation", module: "Finance", href: "/finance/budget/formulation", icon: "📝" },
  { id: "f3", title: "General Ledger", module: "Finance", href: "/finance/accounting/general-ledger", icon: "📒" },
  { id: "f4", title: "Payments", module: "Finance", href: "/finance/payments", icon: "💳" },
  { id: "f5", title: "Bills", module: "Finance", href: "/finance/expenditure/bills", icon: "🧮" },
  { id: "h1", title: "HR Dashboard", module: "HR", href: "/hr/dashboard", icon: "👥" },
  { id: "h2", title: "Leave Management", module: "HR", href: "/hr/leave", icon: "🏖️" },
  { id: "h3", title: "Payroll", module: "HR", href: "/hr/payroll", icon: "💵" },
  { id: "p1", title: "Procurement Dashboard", module: "Procurement", href: "/procurement/dashboard", icon: "📦" },
  { id: "p2", title: "Purchase Orders", module: "Procurement", href: "/procurement/purchase-orders", icon: "🛒" },
  { id: "pj1", title: "Projects Dashboard", module: "Projects", href: "/projects/dashboard", icon: "🏗️" },
  { id: "pj2", title: "Milestones", module: "Projects", href: "/projects/milestones", icon: "🎯" },
  { id: "a1", title: "Assets Dashboard", module: "Assets", href: "/assets/dashboard", icon: "🏢" },
  { id: "c1", title: "CRM Dashboard", module: "CRM", href: "/crm/dashboard", icon: "🤝" },
  { id: "ad1", title: "Admin Settings", module: "Admin", href: "/admin/settings", icon: "⚙️" },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [open]);

  const results = query.trim()
    ? MODULES.filter(
        (m) =>
          m.title.toLowerCase().includes(query.toLowerCase()) ||
          m.module.toLowerCase().includes(query.toLowerCase())
      )
    : MODULES.slice(0, 6);

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.module] ??= []).push(r);
    return acc;
  }, {});

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "15vh",
      }}
    >
      {/* backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(2px)",
        }}
      />
      {/* dialog */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          overflow: "hidden",
        }}
      >
        {/* input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <span style={{ fontSize: 16, color: "#94a3b8" }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules, pages..."
            aria-label="Global search"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 15,
              background: "transparent",
            }}
          />
          <kbd
            style={{
              fontSize: 11,
              padding: "2px 6px",
              background: "#f1f5f9",
              borderRadius: 4,
              color: "#64748b",
              border: "1px solid #e2e8f0",
            }}
          >
            ESC
          </kbd>
        </div>
        {/* results */}
        <div style={{ maxHeight: 360, overflowY: "auto", padding: "8px 0" }}>
          {Object.entries(grouped).map(([module, items]) => (
            <div key={module}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  padding: "8px 16px 4px",
                  letterSpacing: "0.05em",
                }}
              >
                {module}
              </div>
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => navigate(item.href)}
                  type="button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 16px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 14,
                    color: "#1e293b",
                    borderRadius: 0,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span>{item.icon}</span>
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          ))}
          {results.length === 0 && (
            <div style={{ textAlign: "center", padding: 24, color: "#94a3b8", fontSize: 13 }}>
              No results found for &quot;{query}&quot;
            </div>
          )}
        </div>
        {/* footer */}
        <div
          style={{
            borderTop: "1px solid #e5e7eb",
            padding: "8px 16px",
            display: "flex",
            gap: 12,
            fontSize: 11,
            color: "#94a3b8",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
