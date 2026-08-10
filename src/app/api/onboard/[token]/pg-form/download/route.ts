import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generatePgFormPdf } from "@/lib/pgForm/generatePdf";
import { buildPgFormData } from "@/lib/pgForm/data";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (!["PENDING", "REGISTERED", "RESUBMIT"].includes(invite.status)) {
    return NextResponse.json({ error: "Invite is no longer active" }, { status: 400 });
  }

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
  }

  const data = await buildPgFormData(invite.id);
  if (!data) {
    return NextResponse.json({ error: "Unable to prepare PG form" }, { status: 404 });
  }

  const pdfBytes = await generatePgFormPdf(data);

  return new Response(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="pg-form-${invite.role.toLowerCase()}-${invite.id.slice(-6)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
