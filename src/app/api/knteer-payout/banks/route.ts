import { NextResponse } from "next/server";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { flags } from "@/lib/env";
import { getKnteerBanks } from "@/lib/knteer-payout/service";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAuth();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!flags.knteerPayout) {
    return NextResponse.json({ error: "Bank Transfer is not enabled" }, { status: 503 });
  }

  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const popular = url.searchParams.get("popular") === "1" ? true : undefined;
  const imps = url.searchParams.get("imps") === "1" ? true : undefined;
  const neft = url.searchParams.get("neft") === "1" ? true : undefined;

  const result = await getKnteerBanks({ search, popular, imps, neft });
  if (!result.ok) {
    return NextResponse.json({ error: result.message, code: result.code }, { status: 502 });
  }

  return NextResponse.json(result.data);
}
