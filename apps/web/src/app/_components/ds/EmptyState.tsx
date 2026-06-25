import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div className="ic" aria-hidden="true">{icon}</div>}
      <h4>{title}</h4>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}
