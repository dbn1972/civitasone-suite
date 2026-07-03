import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  children: ReactNode;
  crumb?: ReactNode;
  /** Enabled module keys for the current tenant — passed through to Sidebar for filtering. */
  enabledModules?: string[] | null;
}

export function AppShell({ children, crumb, enabledModules }: AppShellProps) {
  return (
    <div className="app">
      <Sidebar enabledModules={enabledModules} />
      <div className="main">
        <TopBar crumb={crumb} />
        <main id="main" tabIndex={-1} className="wrap">
          {children}
        </main>
      </div>
    </div>
  );
}
