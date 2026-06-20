import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

export async function GET(request: NextRequest) {
  const cookieStore = cookies();
  cookieStore.delete(COOKIE.ACCESS);
  cookieStore.delete(COOKIE.REFRESH);
  cookieStore.delete(COOKIE.DEVICE_TRUST);
  return NextResponse.redirect(new URL("/auth/login", request.url));
}
