import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  link?: ReactNode;
  children: ReactNode;
  padding?: boolean;
}

export function Card({ title, link, children, padding = false }: CardProps) {
  return (
    <div className="card">
      {title && (
        <div className="card-h">
          <h3>{title}</h3>
          {link && <div className="lnk">{link}</div>}
        </div>
      )}
      {padding ? <div className="pad">{children}</div> : children}
    </div>
  );
}
