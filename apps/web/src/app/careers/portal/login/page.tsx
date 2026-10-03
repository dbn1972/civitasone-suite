import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { CareersHeader, careersHeaderProps } from "../../CareersHeader";
import { getCareersOrg } from "../../organisation";

export const metadata = { title: "Sign In — Careers Portal" };

// The same office name as the vacancy board (GAP-RECRUITMENT-PORTAL-LOGIN-02): no hard-coded body or
// sovereign claim; an office that has configured nothing gets a neutral header.
export default async function LoginPage({ searchParams }: { searchParams?: { expired?: string } }) {
  const org = await getCareersOrg();
  return (
    <main style={{ minHeight: "100vh", background: "#f0f4f8", paddingBottom: 64 }}>
      <CareersHeader {...await careersHeaderProps(org)} />
      <div style={{ height: 32 }} />
      {/* GAP-RECRUITMENT-CAREERS-PORTAL-03: the portal redirects here when the session cookie is missing/invalid/expired. */}
      {searchParams?.expired === "1" && (
        <div role="status" style={{ maxWidth: 420, margin: "0 auto 16px", padding: "10px 14px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13 }}>
          Your session has expired. Please sign in again.
        </div>
      )}
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
