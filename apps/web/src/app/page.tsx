/**
 * Root page — redirects authenticated users to dashboard,
 * unauthenticated users to /auth/login.
 */
import { redirect } from "next/navigation";

export default function RootPage() {
  // Server component: resolve auth cookie and redirect
  // Full auth check will be added when identity-service client is wired
  redirect("/auth/login");
}
