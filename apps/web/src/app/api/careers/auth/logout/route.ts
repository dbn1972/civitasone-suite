import { NextResponse } from "next/server";

const CAND_COOKIE = "cand_token";

/**
 * Candidate sign-out. POST only (a GET must not mutate state). cand_token is
 * httpOnly so it can only be cleared server-side. 303 turns the form POST into
 * a GET of the login page.
 */
export async function POST() {
  // Relative Location: behind a proxy req.url carries the internal origin.
  const res = new NextResponse(null, { status: 303, headers: { location: "/careers/portal/login" } });
  res.cookies.set(CAND_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
