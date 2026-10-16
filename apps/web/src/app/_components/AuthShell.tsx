import type { ReactNode } from "react";

/**
 * AuthShell — shared centred-card wrapper for every auth screen
 * (login, forgot, dev).
 *
 * GAP-AUTH-FORGOT-05 / GAP-AUTH-LOGIN-05: the three auth screens previously
 * used three different visual languages (dark gradient card for login/dev,
 * PageShell with bg-slate-50 and a left-aligned h1 for forgot). This component
 * provides a single, consistent centred dark-card layout built from Tailwind
 * utility classes (the design system token layer for this app).
 */
interface AuthShellProps {
  children: ReactNode;
}

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        {children}
      </div>
    </main>
  );
}
