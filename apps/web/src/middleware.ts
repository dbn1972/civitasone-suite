import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";
import { defaultLoginPath, isDevLoginEnabled } from "@/lib/auth/env";

const PUBLIC = ["/auth", "/api/auth", "/api/notification", "/careers", "/logout", "/_next", "/favicon.ico", "/sw.js"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/auth/dev") && !isDevLoginEnabled()) {
    return NextResponse.redirect(new URL("/auth/login", req.url));
  }

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const token = req.cookies.get(COOKIE.ACCESS)?.value;
  if (!token) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.url;
    const login = new URL(defaultLoginPath(), appUrl);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
