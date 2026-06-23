import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

interface AppShellProps {
  children: ReactNode;
  crumb?: ReactNode;
}

export function AppShell({ children, crumb }: AppShellProps) {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar crumb={crumb} />
        <div className="wrap">{children}</div>
      </div>
    </div>
  );
}
