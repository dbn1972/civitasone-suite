import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-900" />}>
      <LoginClient />
    </Suspense>
  );
}
