import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@civitasone/ui-kit";
import { COOKIE } from "@/lib/auth/config";
import { SyncProvider } from "@/lib/sync/SyncProvider";

const navGroup = (label: string, links: { href: string; label: string }[]) => (
  <div key={label} className="civitas-nav-group">
    <span className="civitas-nav-group__label">{label}</span>
    {links.map((l) => (
      <Link key={l.href} href={l.href}>{l.label}</Link>
    ))}
  </div>
);

const appNav = (
  <>
    {navGroup("Core", [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/tenant-admin", label: "Tenant Admin" },
    ])}
    {navGroup("Finance", [
      { href: "/finance", label: "Finance" },
      { href: "/finance/dashboard", label: "· Dashboard" },
      { href: "/finance/budget/formulation", label: "· Budget Formulation" },
      { href: "/finance/budget/sanctions", label: "· Sanctions" },
      { href: "/finance/expenditure/bills", label: "· Bills" },
      { href: "/finance/expenditure/advances", label: "· Advances" },
      { href: "/finance/expenditure/utilization-certificates", label: "· Utilization Certificates" },
      { href: "/finance/accounting/general-ledger", label: "· General Ledger" },
      { href: "/finance/accounting/vouchers/new", label: "· New Voucher" },
      { href: "/finance/accounting/financial-statements", label: "· Financial Statements" },
      { href: "/finance/chart-of-accounts", label: "· Chart of Accounts" },
      { href: "/finance/payments", label: "· Payments" },
    ])}
    {navGroup("Operations", [
      { href: "/hr", label: "HR" },
      { href: "/procurement", label: "Procurement" },
      { href: "/projects", label: "Projects" },
      { href: "/grants", label: "Grants" },
      { href: "/estab", label: "Establishment" },
      { href: "/assets", label: "Assets" },
      { href: "/stock", label: "Stock" },
    ])}
    {navGroup("Citizen Services", [
      { href: "/crm", label: "CRM" },
      { href: "/helpdesk", label: "Helpdesk" },
      { href: "/citizen", label: "Citizen Portal" },
    ])}
    {navGroup("Governance", [
      { href: "/audit", label: "Audit" },
      { href: "/legal", label: "Legal" },
    ])}
    {navGroup("Platform", [
      { href: "/reports", label: "Reports" },
      { href: "/knowledge", label: "Knowledge" },
      { href: "/notifications", label: "Notifications" },
    ])}
  </>
);

export default function AppLayout({ children }: { children: ReactNode }) {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) redirect("/auth/login");

  return (
    <>
      <SyncProvider />
      <AppShell
        title="CivitasOne Suite"
        nav={appNav}
        actions={<Link href="/logout">Logout</Link>}
      >
        {children}
      </AppShell>
    </>
  );
}
