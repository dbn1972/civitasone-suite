import type { ReactNode } from "react";

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid g-4">{children}</div>;
}
