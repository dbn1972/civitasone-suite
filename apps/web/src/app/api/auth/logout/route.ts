import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

export async function POST() {
  const jar = cookies();
  jar.delete(COOKIE.ACCESS);
  jar.delete(COOKIE.REFRESH);
  jar.delete(COOKIE.DEVICE_TRUST);
  return NextResponse.json({ ok: true });
}
