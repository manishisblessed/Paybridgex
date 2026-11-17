/**
 * GET & POST /pay/callback?ref=TOPUPXXXXXXXXXX
 *
 * PG (Chagans) redirect-back handler. Many gateways do a FORM-POST redirect
 * after payment (the browser submits a hidden form that POSTs to the callback).
 * Next.js App Router pages can only serve GET — a POST to a page triggers
 * `handleAction` which crashes with "Invalid URL" because the cross-origin
 * Origin header is "null" (privacy policy). This route handler catches both
 * GET and POST, extracts the `ref` query param, and 303-redirects to the
 * static confirmation page (/pay/return) as a clean browser GET.
 *
 * IMPORTANT — do NOT build the redirect target from `req.url`'s origin. Behind
 * the nginx reverse proxy (PM2 `next start` on 127.0.0.1:3000) Next.js resolves
 * `req.url` to `http://localhost:3000`, so a redirect built from it bounces the
 * payer to a dead `localhost:3000/pay/return` page right after a SUCCESSFUL
 * payment (ERR_CONNECTION_REFUSED). We always build the destination from the
 * canonical, configured `NEXT_PUBLIC_APP_URL` (https://paybridgex.in) instead.
 */
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function redirect(req: Request): NextResponse {
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  const dest = `${base}/pay/return${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  // 303 See Other → the browser follows with a clean GET (the PG form-POSTs here,
  // and /pay/return is a GET-only page).
  return NextResponse.redirect(dest, 303);
}

export async function GET(req: Request) {
  return redirect(req);
}

export async function POST(req: Request) {
  return redirect(req);
}
