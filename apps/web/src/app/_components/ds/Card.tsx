import type { ReactNode, CSSProperties } from "react";

interface CardProps {
  title?: string;
  link?: ReactNode;
  children: ReactNode;
  padding?: boolean;
  style?: CSSProperties;
}

export function Card({ title, link, children, padding = false, style }: CardProps) {
  return (
    <div className="card" style={style}>
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
