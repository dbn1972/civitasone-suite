import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign In — Careers Portal" };

export default function LoginPage({ searchParams }: { searchParams?: { expired?: string } }) {
  return (
    <main style={{ minHeight: "100vh", background: "#f0f4f8", paddingTop: 48, paddingBottom: 64 }}>
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
