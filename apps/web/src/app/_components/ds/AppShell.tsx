import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { KeyboardShortcuts } from "../KeyboardShortcuts";
import { WhatsNewBanner } from "../WhatsNewBanner";
import { FeedbackWidget } from "../FeedbackWidget";
import { AskCivitasOne } from "../AskCivitasOne";
import { RouteProgress } from "../RouteProgress";
import { AutoBreadcrumb } from "../AutoBreadcrumb";
import { PageTitleSync } from "../PageTitleSync";
import { HeaderLanguageToggle } from "../HeaderLanguageToggle";
import { AppFooter } from "../AppFooter";

interface AppShellProps {
  children: ReactNode;
  crumb?: ReactNode;
  /** Enabled module keys for the current tenant — passed through to Sidebar for filtering. */
  enabledModules?: string[] | null;
  /** Logged-in user display name from JWT claims. */
  userName?: string;
  /** Logged-in user role label from JWT claims. */
  userRole?: string;
  /** Full JWT roles claim — passed through to Sidebar for role-gated nav entries (e.g. Finance). */
  roles?: string[] | null;
}

export function AppShell({ children, crumb, enabledModules, userName, userRole, roles }: AppShellProps) {
  return (
    <div className="app">
      <RouteProgress />
      <Sidebar enabledModules={enabledModules} userName={userName} userRole={userRole} roles={roles} />
      <div className="main">
        <TopBar crumb={crumb ?? <AutoBreadcrumb />} userName={userName} languageToggle={<HeaderLanguageToggle />} />
        <WhatsNewBanner />
        <main id="main" tabIndex={-1} className="wrap">
          {children}
          {/* UAT-P2-D4 (GLB-01): inline at the end of the content, never floating over it. */}
          <FeedbackWidget />
        </main>
        <AppFooter />
      </div>
      <PageTitleSync />
      <KeyboardShortcuts />
      <AskCivitasOne />
    </div>
  );
}
