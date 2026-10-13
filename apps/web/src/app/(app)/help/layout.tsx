import type { ReactNode } from "react";

/**
 * SF-20: intentionally open to every signed-in user. Help guides are static content with no
 * backend call; the help hub already hides guides for modules the tenant has disabled
 * (lib/moduleVisibility.ts).
 */
export default function HelpLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
