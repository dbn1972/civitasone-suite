import type { ReactNode } from "react";

export type AppShellProps = {
  title: string;
  nav?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
};

export function AppShell({ title, nav, actions, children }: AppShellProps) {
  return (
    <div className="civitas-shell">
      <header className="civitas-shell__header">
        <div className="civitas-shell__brand">{title}</div>
        {nav ? <nav className="civitas-shell__nav">{nav}</nav> : null}
        {actions ? <div className="civitas-shell__actions">{actions}</div> : null}
      </header>
      <main className="civitas-shell__main">{children}</main>
    </div>
  );
}
