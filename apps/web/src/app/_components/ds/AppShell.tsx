import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { KeyboardShortcuts } from "../KeyboardShortcuts";
import { WhatsNewBanner } from "../WhatsNewBanner";
import { FeedbackWidget } from "../FeedbackWidget";
import { AskCivitasOne } from "../AskCivitasOne";

interface AppShellProps {
  children: ReactNode;
  crumb?: ReactNode;
  /** Enabled module keys for the current tenant — passed through to Sidebar for filtering. */
  enabledModules?: string[] | null;
  /** Logged-in user display name from JWT claims. */
  userName?: string;
}

export function AppShell({ children, crumb, enabledModules, userName }: AppShellProps) {
  return (
    <div className="app">
      <Sidebar enabledModules={enabledModules} />
      <div className="main">
        <TopBar crumb={crumb} userName={userName} />
        <WhatsNewBanner />
        <main id="main" tabIndex={-1} className="wrap">
          {children}
        </main>
      </div>
      <KeyboardShortcuts />
      <AskCivitasOne />
      <FeedbackWidget />
    </div>
  );
}
