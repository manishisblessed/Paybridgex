import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { dec, toNumber } from "@/lib/money";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

const EXPORT_CAP = 10_000;

/**
 * GET /api/admin/wallet/ledger — platform-wide ledger browser.
 * Filters: q (user name/email/shop), userId, walletType, direction, reason,
 * refType, from, to. `format=csv` streams an export (capped).
 */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "FINANCE");
    const { searchParams } = new URL(req.url);

    const q = searchParams.get("q") ?? "";
    const userId = searchParams.get("userId");
    const walletType = searchParams.get("walletType");
    const direction = searchParams.get("direction");
    const reason = searchParams.get("reason");
    const refType = searchParams.get("refType");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const format = searchParams.get("format");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(10, Number(searchParams.get("pageSize") ?? 50)));

    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (walletType && ["PRIMARY", "AEPS"].includes(walletType)) where.walletType = walletType;
    if (direction && ["CREDIT", "DEBIT"].includes(direction)) where.direction = direction;
    if (reason && reason !== "all") where.reason = reason;
    if (refType && refType !== "all") where.refType = refType;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
      };
    }
    if (q && !userId) {
      where.user = {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { shopName: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      };
    }

    if (format === "csv" || format === "zip") {
      const rows = await prisma.walletTxn.findMany({
        where: where as never,
        include: { user: { select: { name: true, email: true, role: true } } },
        orderBy: { createdAt: "desc" },
        take: EXPORT_CAP,
      });
      const esc = (v: unknown) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header =
        "Date,User,Email,Role,Wallet,Direction,Reason,Amount,BalanceAfter,RefType,RefId,Note";
      const lines = rows.map((t) =>
        [
          t.createdAt.toISOString(),
          esc(t.user.name),
          esc(t.user.email),
          t.user.role,
          t.walletType,
          t.direction,
          t.reason,
          toNumber(dec(t.amount)),
          toNumber(dec(t.balanceAfter)),
          esc(t.refType),
          esc(t.refId),
          esc(t.note),
        ].join(",")
      );
      const csvContent = [header, ...lines].join("\n");
      const dateStr = new Date().toISOString().slice(0, 10);

      if (format === "zip") {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        zip.file(`ledger-${dateStr}.csv`, csvContent);
        const buf = Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
        return new NextResponse(buf, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="ledger-${dateStr}.zip"`,
          },
        });
      }

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="ledger-${dateStr}.csv"`,
        },
      });
    }

    const [rows, total, sums] = await Promise.all([
      prisma.walletTxn.findMany({
        where: where as never,
        include: {
          user: { select: { userCode: true, name: true, email: true, shopName: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.walletTxn.count({ where: where as never }),
      prisma.walletTxn.groupBy({
        by: ["direction"],
        where: where as never,
        _sum: { amount: true },
      }),
    ]);

    const creditSum = sums.find((s) => s.direction === "CREDIT")?._sum.amount;
    const debitSum = sums.find((s) => s.direction === "DEBIT")?._sum.amount;

    return NextResponse.json({
      entries: rows.map((t) => ({
        id: t.id,
        userId: t.userId,
        user: t.user,
        walletType: t.walletType,
        direction: t.direction,
        reason: t.reason,
        amount: toNumber(dec(t.amount)),
        balanceAfter: toNumber(dec(t.balanceAfter)),
        refType: t.refType,
        refId: t.refId,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      sums: {
        credit: toNumber(dec(creditSum ?? 0)),
        debit: toNumber(dec(debitSum ?? 0)),
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/wallet/ledger] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
