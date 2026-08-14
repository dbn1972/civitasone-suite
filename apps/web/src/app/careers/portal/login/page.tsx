import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign In — Careers Portal" };

export default function LoginPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#f0f4f8", paddingTop: 48, paddingBottom: 64 }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
