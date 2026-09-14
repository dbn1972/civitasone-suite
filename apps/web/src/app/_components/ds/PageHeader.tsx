import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface PageHeaderProps {
  /**
   * Plain string in most cases. Accepts ReactNode so a title/subtitle that
   * leads with a specialist acronym can compose the shared `Term` component
   * (e.g. `title={<>Utilisation Certificates <Term name="UC" /></>}`) and get
   * a real, visible glossary "?" tooltip right where the acronym appears,
   * instead of leaving it bare. Plain strings render exactly as before.
   */
  title: ReactNode;
  subtitle?: ReactNode;
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
        <span className="back">
          {/*
            An icon, not a "←" text glyph: axe's color-contrast rule cannot
            reliably measure contrast for decorative Unicode arrow characters
            (reported as "nonBmp" / non-text content) and treats that as an
            undecided, blocking result. An SVG icon isn't subject to that
            text-contrast heuristic.
          */}
          <ArrowLeft aria-hidden="true" size={14} />
          <Link href={back}>{backLabel ?? 'Back'}</Link>
        </span>
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
