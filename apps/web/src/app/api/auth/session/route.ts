import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

export async function GET() {
  const at = cookies().get(COOKIE.ACCESS)?.value;
  return NextResponse.json({ authenticated: Boolean(at) });
}
