import type { ReactNode } from "react";
import Link from "next/link";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  back?: string;
  backLabel?: string;
}

export function PageHeader({ title, subtitle, actions, back, backLabel }: PageHeaderProps) {
  return (
    <>
      {back && (
        <span className="back">← <Link href={back}>{backLabel ?? 'Back'}</Link></span>
      )}
      <div className="ph">
        <div>
          <h1>{title}</h1>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        {actions && <div className="ph-act">{actions}</div>}
      </div>
    </>
  );
}
