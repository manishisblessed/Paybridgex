/**
 * GET & POST /pay/callback?ref=TOPUPXXXXXXXXXX
 *
 * PG (Chagans) redirect-back handler. Many gateways do a FORM-POST redirect
 * after payment (the browser submits a hidden form that POSTs to the callback).
 * Next.js App Router pages can only serve GET — a POST to a page triggers
 * `handleAction` which crashes with "Invalid URL" because the cross-origin
 * Origin header is "null" (privacy policy). This route handler catches both
 * GET and POST, extracts the `ref` query param, and 302-redirects to the
 * static confirmation page (/pay/return) as a clean browser GET.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function redirect(req: Request): NextResponse {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") ?? "";
  const dest = new URL(`/pay/return${ref ? `?ref=${ref}` : ""}`, url.origin);
  return NextResponse.redirect(dest.toString(), 302);
}

export async function GET(req: Request) {
  return redirect(req);
}

export async function POST(req: Request) {
  return redirect(req);
}
