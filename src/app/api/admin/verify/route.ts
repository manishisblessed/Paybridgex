import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireRole, AuthError } from "@/lib/auth-server";
import { requireAdminActivity } from "@/lib/security/adminActivity";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import {
  ekychubConfigured,
  verifyPan360,
  verifyGst,
  verifyBankAdvance,
  verifyPennyDrop,
  verifyCin,
} from "@/lib/partners/ekychub";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — verification history (VerificationResult), filterable by type. */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT");

    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? "all";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = 25;

    const where = type !== "all" ? { type } : {};
    const [rows, total] = await Promise.all([
      prisma.verificationResult.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.verificationResult.count({ where }),
    ]);

    const userIds = Array.from(new Set(rows.map((r) => r.userId).filter((v): v is string => Boolean(v))));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json({
      checks: rows.map((r) => ({
        id: r.id,
        type: r.type,
        orderid: r.orderid,
        status: r.status,
        verifiedName: r.verifiedName,
        createdAt: r.createdAt.toISOString(),
        user: r.userId ? userMap.get(r.userId) ?? null : null,
        // Response payloads can carry PII — expose only the summary here.
      })),
      total,
      page,
      pageSize,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/verify] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PAN_360"), pan: z.string().regex(/^[A-Za-z]{5}\d{4}[A-Za-z]$/, "Invalid PAN format") }),
  z.object({ type: z.literal("GST"), gst: z.string().min(15).max(15) }),
  z.object({
    type: z.literal("BANK_ADVANCE"),
    accountNumber: z.string().min(6).max(20),
    ifsc: z.string().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, "Invalid IFSC"),
  }),
  z.object({
    type: z.literal("BANK_PENNY_DROP"),
    accountNumber: z.string().min(6).max(20),
    ifsc: z.string().regex(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, "Invalid IFSC"),
  }),
  z.object({ type: z.literal("CIN"), cin: z.string().min(10).max(30) }),
]);

/**
 * POST — run a verification check via eKYC Hub and persist the result to
 * VerificationResult (full request/response for audit).
 */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireAdminActivity(req, {
      action: "verify.check_run",
      roles: ["MASTER_ADMIN", "ADMIN", "SUPPORT"],
      entity: "VerificationResult",
    });
  } catch (e) {
    return toErrorResponse(e);
  }

  if (!ekychubConfigured())
    return NextResponse.json(
      { error: "Verification provider (eKYC Hub) is not configured" },
      { status: 503 }
    );

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const orderid = `ADM${nanoid(12).toUpperCase()}`;

  let result:
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; code?: string; message: string };
  let requestPayload: Record<string, unknown>;

  switch (body.type) {
    case "PAN_360":
      requestPayload = { pan: body.pan.toUpperCase() };
      result = (await verifyPan360({ pan: body.pan, orderid })) as typeof result;
      break;
    case "GST":
      requestPayload = { gst: body.gst.toUpperCase() };
      result = (await verifyGst({ gst: body.gst, orderid })) as typeof result;
      break;
    case "BANK_ADVANCE":
      requestPayload = { accountNumber: `••••${body.accountNumber.slice(-4)}`, ifsc: body.ifsc.toUpperCase() };
      result = (await verifyBankAdvance({
        account_number: body.accountNumber,
        ifsc: body.ifsc,
        orderid,
      })) as typeof result;
      break;
    case "BANK_PENNY_DROP":
      requestPayload = { accountNumber: `••••${body.accountNumber.slice(-4)}`, ifsc: body.ifsc.toUpperCase() };
      result = (await verifyPennyDrop({
        account_number: body.accountNumber,
        ifsc: body.ifsc,
        orderid,
      })) as typeof result;
      break;
    case "CIN":
      requestPayload = { cin: body.cin.toUpperCase() };
      result = (await verifyCin({ cin: body.cin, orderid })) as typeof result;
      break;
  }

  const data = result.ok ? result.data : null;
  const verifiedName = data
    ? String(
        (data as Record<string, unknown>).full_name ??
          (data as Record<string, unknown>).nameAtBank ??
          (data as Record<string, unknown>).legal_name_of_business ??
          (data as Record<string, unknown>).company_name ??
          ""
      ) || null
    : null;

  await prisma.verificationResult.create({
    data: {
      userId: null,
      type: body.type,
      orderid,
      status: result.ok ? "Success" : "Failure",
      verifiedName,
      requestPayload: requestPayload as object,
      responsePayload: (result.ok ? data : { error: result.message }) as object,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "verify.check_run",
      entity: "VerificationResult",
      entityId: orderid,
      meta: { type: body.type, ok: result.ok },
      ip: clientIp(req),
    },
  });

  if (!result.ok)
    return NextResponse.json({ ok: false, orderid, error: result.message }, { status: 400 });

  return NextResponse.json({ ok: true, orderid, verifiedName, data });
}
