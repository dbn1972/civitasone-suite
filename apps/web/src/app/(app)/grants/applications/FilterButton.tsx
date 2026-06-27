"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function FilterButton() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn ghost"
        style={{ minHeight: 44 }}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        Filter ▾
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 4,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            minWidth: 160,
            zIndex: 50,
            padding: "4px 0",
          }}
        >
          {["active", "completed", "pending"].map((status) => (
            <button
              key={status}
              type="button"
              role="menuitem"
              className="btn ghost"
              style={{ width: "100%", textAlign: "left", borderRadius: 0, minHeight: 40 }}
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set("status", status);
                router.push(`/grants/applications?${params.toString()}`);
                setOpen(false);
              }}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
