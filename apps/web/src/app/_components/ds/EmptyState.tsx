import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Emoji string, or omit/null for the default SVG illustration. */
  icon?: string | null;
  title: string;
  message?: string;
  action?: ReactNode;
}

function DefaultIllustration() {
  return (
    <svg
      aria-hidden="true"
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ opacity: 0.3 }}
    >
      <rect x="8" y="14" width="56" height="44" rx="6" stroke="currentColor" strokeWidth="2.5" />
      <path d="M8 26h56" stroke="currentColor" strokeWidth="2" />
      <rect x="16" y="34" width="22" height="4" rx="2" fill="currentColor" />
      <rect x="16" y="42" width="14" height="4" rx="2" fill="currentColor" />
      <circle cx="52" cy="46" r="9" stroke="currentColor" strokeWidth="2.5" />
      <path d="M58.5 52.5l4.5 4.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="ic" aria-hidden="true">
        {icon ? icon : <DefaultIllustration />}
      </div>
      <h4>{title}</h4>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}
