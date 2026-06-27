import type { ReactNode } from "react";
import Link from "next/link";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  back?: string;
  backLabel?: string;
  /** Optional Help Centre slug — renders a plain-language "How this works" link. */
  help?: string;
}

export function PageHeader({ title, subtitle, actions, back, backLabel, help }: PageHeaderProps) {
  return (
    <>
      {back && (
        <span className="back">← <Link href={back}>{backLabel ?? 'Back'}</Link></span>
      )}
      <div className="ph">
        <div>
          <h1 id="page-heading">{title}</h1>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        {(actions || help) && (
          <div className="ph-act">
            {actions}
            {help && (
              <Link
                href={`/help/${help}`}
                className="btn ghost"
                aria-label="How this works — plain-language help"
                title="How this works"
              >
                ❓ How this works
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}
