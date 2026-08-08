"use client";

import type { KeyboardEvent, ReactNode } from "react";

export type BlockStatus = "empty" | "in-progress" | "complete" | "error";

export interface DesignerBlock {
  id: string;
  label: string;
  shortLabel: string;
  hidden?: boolean;
  status: BlockStatus;
  errorCount?: number;
}

export interface BlockRailProps {
  blocks: DesignerBlock[];
  activeBlockId: string;
  onSelect: (blockId: string) => void;
}

function statusLabel(status: BlockStatus, errorCount?: number): string {
  if (status === "error" && errorCount) return `${errorCount} issue${errorCount === 1 ? "" : "s"}`;
  switch (status) {
    case "complete": return "Complete";
    case "in-progress": return "In progress";
    case "error": return "Needs attention";
    default: return "Not started";
  }
}

export function BlockRail({ blocks, activeBlockId, onSelect }: BlockRailProps) {
  const handleKey = (e: KeyboardEvent<HTMLButtonElement>, block: DesignerBlock) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!block.hidden) onSelect(block.id);
    }
  };

  return (
    <nav aria-label="Service composition blocks" className="designer-block-rail">
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {blocks.map((block) => {
          const active = block.id === activeBlockId;
          const hidden = block.hidden === true;
          return (
            <li key={block.id}>
              <button
                type="button"
                className={`designer-block-rail__item${active ? " is-active" : ""}${hidden ? " is-hidden" : ""}`}
                aria-current={active ? "step" : undefined}
                aria-disabled={hidden || undefined}
                title={hidden ? "Not used by this pattern" : undefined}
                onClick={() => { if (!hidden) onSelect(block.id); }}
                onKeyDown={(e) => handleKey(e, block)}
                style={{
                  width: "100%",
                  textAlign: "start",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: "var(--r-sm)",
                  border: active ? "1px solid var(--primary)" : "1px solid transparent",
                  background: active ? "var(--primary-soft)" : "transparent",
                  opacity: hidden ? 0.55 : 1,
                  textDecoration: hidden ? "line-through" : "none",
                  cursor: hidden ? "not-allowed" : "pointer",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background:
                      block.status === "complete" ? "var(--good-fg)"
                        : block.status === "in-progress" ? "var(--info-fg)"
                          : block.status === "error" ? "var(--bad-fg)"
                            : "var(--line2)",
                  }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>
                    {block.shortLabel} — {block.label}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "var(--mut)" }}>
                    {hidden ? "Not used by this pattern" : statusLabel(block.status, block.errorCount)}
                  </span>
                </span>
                {block.errorCount && block.errorCount > 0 ? (
                  <span
                    aria-label={`${block.errorCount} errors`}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--bad-fg)",
                      background: "var(--bad-bg)",
                      border: "1px solid var(--bad-border)",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {block.errorCount}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface WizardShellProps {
  serviceName: string;
  patternLabel: string;
  version: number;
  status: string;
  saveState: "saving" | "saved" | "offline";
  blocks: DesignerBlock[];
  activeBlockId: string;
  onBlockSelect: (blockId: string) => void;
  onBack?: () => void;
  onNext?: () => void;
  canRunTest?: boolean;
  canSubmit?: boolean;
  onRunTest?: () => void;
  onSubmit?: () => void;
  submitBusy?: boolean;
  children: ReactNode;
  help?: ReactNode;
  /** Optional meter / note rendered beside the autosave label (e.g. locale completeness). */
  footerMeta?: ReactNode;
}

export function WizardShell({
  serviceName,
  patternLabel,
  version,
  status,
  saveState,
  blocks,
  activeBlockId,
  onBlockSelect,
  onBack,
  onNext,
  canRunTest = false,
  canSubmit = false,
  onRunTest,
  onSubmit,
  submitBusy = false,
  children,
  help,
  footerMeta,
}: WizardShellProps) {
  const saveLabel =
    saveState === "saving" ? "Saving…"
      : saveState === "offline" ? "Offline — retrying"
        : "Saved just now";

  return (
    <div className="designer-wizard" style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 120px)" }}>
      <header
        className="designer-wizard__header"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: "12px 0",
          borderBottom: "1px solid var(--line)",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, color: "var(--ink)" }}>{serviceName}</h2>
        <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "var(--panel)", border: "1px solid var(--line)" }}>
          {patternLabel}
        </span>
        <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "var(--panel)", border: "1px solid var(--line)" }}>
          v{version}
        </span>
        <span style={{ fontSize: 12, color: "var(--mut)", textTransform: "capitalize" }}>{status.replace("_", " ")}</span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 20, flex: 1, alignItems: "start" }}>
        <aside>
          <BlockRail blocks={blocks} activeBlockId={activeBlockId} onSelect={onBlockSelect} />
        </aside>
        <main>{children}</main>
        {help ? (
          <aside aria-label="Context help" style={{ maxWidth: 260 }}>
            {help}
          </aside>
        ) : null}
      </div>

      <footer
        className="designer-wizard__footer"
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: 24,
          padding: "12px 16px",
          background: "var(--panel)",
          borderTop: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }} aria-live="polite">{saveLabel}</span>
          {footerMeta ? (
            <span data-testid="wizard-footer-meta" style={{ fontSize: 12, color: "var(--mut)" }}>
              {footerMeta}
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onBack ? (
            <button type="button" className="btn ghost" onClick={onBack}>Back</button>
          ) : null}
          {onNext ? (
            <button type="button" className="btn primary" onClick={onNext}>Next</button>
          ) : null}
          <button
            type="button"
            className="btn ghost"
            disabled={!canRunTest}
            onClick={onRunTest}
            title={canRunTest ? undefined : "Complete all active blocks first"}
          >
            Run Test
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canSubmit || submitBusy}
            onClick={onSubmit}
            title={canSubmit ? undefined : "Pass the latest sandbox test before submitting"}
          >
            {submitBusy ? "Submitting…" : "Submit for Approval"}
          </button>
        </div>
      </footer>
    </div>
  );
}
