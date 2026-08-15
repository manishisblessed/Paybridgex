import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEsignDetails, leegalityConfigured } from "@/lib/partners/leegality";

/**
 * Leegality webhook — signing progress notifications.
 *
 * Configure in the Leegality dashboard (workflow → webhooks) pointing at
 *   https://app.paybridgex.in/api/webhooks/leegality
 *
 * Leegality does not sign webhook payloads, so we treat the body as a HINT
 * only: we take the documentId, re-fetch the authoritative state from the
 * Leegality API with our X-Auth-Token, and update our records from THAT.
 * A forged payload can therefore only make us re-verify a real document.
 */
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const TYPE = "AGREEMENT_ESIGN";

export async function POST(req: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const documentId =
    (typeof payload.documentId === "string" && payload.documentId) ||
    (typeof (payload.document as Record<string, unknown> | undefined)?.documentId === "string" &&
      ((payload.document as Record<string, unknown>).documentId as string)) ||
    null;

  if (!documentId) return NextResponse.json({ ok: true, matched: false });

  const record = await prisma.verificationResult.findUnique({
    where: { orderid: documentId },
  });
  if (!record || record.type !== TYPE) {
    return NextResponse.json({ ok: true, matched: false });
  }

  if (!leegalityConfigured()) {
    return NextResponse.json({ ok: true, matched: true, verified: false });
  }

  const r = await getEsignDetails(documentId);
  if (!r.ok) return NextResponse.json({ ok: true, matched: true, verified: false });

  const statusLabel =
    r.data.status === "COMPLETED" ? "Completed"
    : r.data.status === "PARTIALLY_SIGNED" ? "PartiallySigned"
    : r.data.status === "EXPIRED" ? "Expired"
    : r.data.status === "DELETED" ? "Deleted"
    : "Pending";

  await prisma.verificationResult.update({
    where: { id: record.id },
    data: { status: statusLabel, responsePayload: r.data as unknown as Prisma.InputJsonValue },
  });
  await prisma.auditLog.create({
    data: {
      action: "webhook.leegality",
      entity: "Invite",
      entityId: record.inviteId,
      meta: { documentId, status: statusLabel },
    },
  });

  return NextResponse.json({ ok: true, matched: true, status: statusLabel });
}
