import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ekychubConfigured,
  verifyPan360,
  verifyPennyDrop,
  verifyGst,
  verifyBankAdvance,
  createDigilockerUrl,
  getDigilockerDocument,
} from "@/lib/partners/ekychub";
import crypto from "crypto";

function generateOrderId(): string {
  return `ORD_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

const PanBody = z.object({
  type: z.literal("PAN_360"),
  pan: z.string().length(10).regex(/^[A-Z]{5}\d{4}[A-Z]$/),
});

const BankBody = z.object({
  type: z.literal("BANK_PENNY_DROP"),
  account_number: z.string().min(8).max(20),
  ifsc: z.string().length(11),
});

const BankAdvanceBody = z.object({
  type: z.literal("BANK_ADVANCE"),
  account_number: z.string().min(8).max(20),
  ifsc: z.string().length(11),
});

const GstBody = z.object({
  type: z.literal("GST"),
  gst: z.string().length(15),
});

const AadhaarInitBody = z.object({
  type: z.literal("AADHAAR_INIT"),
  redirect_url: z.string().url(),
});

const AadhaarCompleteBody = z.object({
  type: z.literal("AADHAAR_COMPLETE"),
  verification_id: z.string().min(1),
  reference_id: z.string().min(1),
});

const VerifyBody = z.discriminatedUnion("type", [
  PanBody,
  BankBody,
  BankAdvanceBody,
  GstBody,
  AadhaarInitBody,
  AadhaarCompleteBody,
]);

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (!["PENDING", "REGISTERED"].includes(invite.status)) {
    return NextResponse.json(
      { error: "Invite is no longer active for verification" },
      { status: 400 }
    );
  }

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
  }

  if (!ekychubConfigured()) {
    return NextResponse.json(
      { error: "Verification service is not configured" },
      { status: 503 }
    );
  }

  const parsed = VerifyBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const orderid = generateOrderId();

  switch (data.type) {
    case "PAN_360": {
      const result = await verifyPan360({ pan: data.pan, orderid });

      // PAN uniqueness gate — block before storing if already used
      if (result.ok) {
        const excludeUserId = invite.userId ?? undefined;
        const dupPan = await prisma.kyc.findFirst({
          where: {
            panNumber: data.pan.toUpperCase(),
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
          },
          select: { userId: true },
        });
        if (dupPan) {
          return NextResponse.json(
            {
              ok: false,
              type: "PAN_360",
              message: "This PAN is already linked to another NextGenPay account.",
              code: "PAN_DUPLICATE",
            },
            { status: 409 }
          );
        }
      }

      await prisma.verificationResult.create({
        data: {
          inviteId: invite.id,
          userId: invite.userId,
          type: "PAN_360",
          orderid,
          status: result.ok ? "Success" : "Failure",
          verifiedName: result.ok ? result.data.registered_name : null,
          requestPayload: { pan: data.pan },
          responsePayload: result.raw as any,
        },
      });

      if (result.ok) {
        return NextResponse.json({
          ok: true,
          type: "PAN_360",
          data: {
            registered_name: result.data.registered_name,
            pan: result.data.pan,
            type: result.data.type,
            gender: result.data.gender,
            date_of_birth: result.data.date_of_birth,
            aadhaar_linked: result.data.aadhaar_linked,
          },
        });
      }
      return NextResponse.json(
        { ok: false, type: "PAN_360", message: result.message },
        { status: 422 }
      );
    }

    case "BANK_PENNY_DROP": {
      const result = await verifyPennyDrop({
        account_number: data.account_number,
        ifsc: data.ifsc,
        orderid,
      });

      if (result.ok) {
        const excludeUserId = invite.userId ?? undefined;
        const dupBank = await prisma.kyc.findFirst({
          where: {
            bankAccountNumber: data.account_number,
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
          },
          select: { userId: true },
        });
        if (dupBank) {
          return NextResponse.json(
            {
              ok: false,
              type: "BANK_PENNY_DROP",
              message: "This bank account is already linked to another NextGenPay account.",
              code: "BANK_DUPLICATE",
            },
            { status: 409 }
          );
        }
      }

      await prisma.verificationResult.create({
        data: {
          inviteId: invite.id,
          userId: invite.userId,
          type: "BANK_PENNY_DROP",
          orderid,
          status: result.ok ? "Success" : "Failure",
          verifiedName: result.ok ? result.data.nameAtBank : null,
          requestPayload: { account_number: data.account_number, ifsc: data.ifsc },
          responsePayload: result.raw as any,
        },
      });

      if (result.ok) {
        const rawStatus = (result.raw as any)?.account_status
          ?? (result.raw as any)?.accountStatus;
        return NextResponse.json({
          ok: true,
          type: "BANK_PENNY_DROP",
          data: {
            nameAtBank: result.data.nameAtBank,
            utr: result.data.utr,
            accountStatus: rawStatus ?? "active",
            depositAmount: 1,
          },
        });
      }
      return NextResponse.json(
        { ok: false, type: "BANK_PENNY_DROP", message: result.message },
        { status: 422 }
      );
    }

    case "BANK_ADVANCE": {
      const result = await verifyBankAdvance({
        account_number: data.account_number,
        ifsc: data.ifsc,
        orderid,
      });

      if (result.ok) {
        const excludeUserId = invite.userId ?? undefined;
        const dupBank = await prisma.kyc.findFirst({
          where: {
            bankAccountNumber: data.account_number,
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
          },
          select: { userId: true },
        });
        if (dupBank) {
          return NextResponse.json(
            {
              ok: false,
              type: "BANK_ADVANCE",
              message: "This bank account is already linked to another NextGenPay account.",
              code: "BANK_DUPLICATE",
            },
            { status: 409 }
          );
        }
      }

      await prisma.verificationResult.create({
        data: {
          inviteId: invite.id,
          userId: invite.userId,
          type: "BANK_ADVANCE",
          orderid,
          status: result.ok ? "Success" : "Failure",
          verifiedName: result.ok ? result.data.nameAtBank : null,
          requestPayload: { account_number: data.account_number, ifsc: data.ifsc },
          responsePayload: result.raw as any,
        },
      });

      if (result.ok) {
        return NextResponse.json({
          ok: true,
          type: "BANK_ADVANCE",
          data: {
            nameAtBank: result.data.nameAtBank,
            bankName: result.data.bankName,
            branch: result.data.branch,
            city: result.data.city,
          },
        });
      }
      return NextResponse.json(
        { ok: false, type: "BANK_ADVANCE", message: result.message },
        { status: 422 }
      );
    }

    case "GST": {
      const result = await verifyGst({ gst: data.gst, orderid });

      if (result.ok) {
        const excludeUserId = invite.userId ?? undefined;
        const dupGst = await prisma.kyc.findFirst({
          where: {
            gstin: data.gst.toUpperCase(),
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
          },
          select: { userId: true },
        });
        if (dupGst) {
          return NextResponse.json(
            {
              ok: false,
              type: "GST",
              message: "This GST number is already linked to another NextGenPay account.",
              code: "GST_DUPLICATE",
            },
            { status: 409 }
          );
        }
      }

      await prisma.verificationResult.create({
        data: {
          inviteId: invite.id,
          userId: invite.userId,
          type: "GST",
          orderid,
          status: result.ok ? "Success" : "Failure",
          verifiedName: result.ok ? result.data.legal_name_of_business : null,
          requestPayload: { gst: data.gst },
          responsePayload: result.raw as any,
        },
      });

      if (result.ok) {
        return NextResponse.json({
          ok: true,
          type: "GST",
          data: {
            legal_name: result.data.legal_name_of_business,
            trade_name: result.data.trade_name_of_business,
            gst_status: result.data.gst_in_status,
            taxpayer_type: result.data.taxpayer_type,
            address: result.data.principal_place_address,
          },
        });
      }
      return NextResponse.json(
        { ok: false, type: "GST", message: result.message },
        { status: 422 }
      );
    }

    case "AADHAAR_INIT": {
      const result = await createDigilockerUrl({
        document_type: "AADHAAR",
        redirect_url: data.redirect_url,
        orderid,
      });

      await prisma.verificationResult.create({
        data: {
          inviteId: invite.id,
          userId: invite.userId,
          type: "AADHAAR_DIGILOCKER_INIT",
          orderid,
          status: result.ok ? "Success" : "Failure",
          requestPayload: { redirect_url: data.redirect_url },
          responsePayload: result.raw as any,
        },
      });

      if (result.ok) {
        return NextResponse.json({
          ok: true,
          type: "AADHAAR_INIT",
          data: {
            url: result.data.url,
            verification_id: result.data.verification_id,
            reference_id: result.data.reference_id,
          },
        });
      }
      return NextResponse.json(
        { ok: false, type: "AADHAAR_INIT", message: result.message },
        { status: 422 }
      );
    }

    case "AADHAAR_COMPLETE": {
      const result = await getDigilockerDocument({
        verification_id: data.verification_id,
        reference_id: data.reference_id,
        orderid,
        document_type: "AADHAAR",
      });

      const aadhaarMobile = result.ok
        ? ((result.raw as any)?.mobile_number ??
           (result.raw as any)?.phone ??
           null)
        : null;

      // ── Aadhaar uniqueness gate ──────────────────────────────────
      // Block BEFORE storing the result if the same Aadhaar already
      // belongs to another user. Checks:
      //  1. Kyc.aadhaarNumber (full masked uid)
      //  2. Kyc.aadhaarLast4  (catches legacy records with NULL aadhaarNumber)
      //  3. Prior successful VerificationResult with matching uid
      if (result.ok) {
        const uid = result.data.uid;
        const last4 = uid ? uid.slice(-4) : null;
        const excludeUserId = invite.userId ?? undefined;

        // Check 1 & 2: existing Kyc records
        const dupKyc = await prisma.kyc.findFirst({
          where: {
            OR: [
              ...(uid ? [{ aadhaarNumber: uid }] : []),
              ...(last4 ? [{ aadhaarLast4: last4, aadhaarNumber: null }] : []),
            ],
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
          },
          select: { userId: true },
        });

        if (dupKyc) {
          return NextResponse.json(
            {
              ok: false,
              type: "AADHAAR_COMPLETE",
              message: "This Aadhaar is already linked to another NextGenPay account. Each Aadhaar can only be used once.",
              code: "AADHAAR_DUPLICATE",
            },
            { status: 409 }
          );
        }

        // Check 3: another invite's successful DigiLocker verification
        const dupVerification = await prisma.verificationResult.findFirst({
          where: {
            type: "AADHAAR_DIGILOCKER",
            status: "Success",
            ...(invite.id ? { inviteId: { not: invite.id } } : {}),
            responsePayload: { path: ["uid"], equals: uid },
          },
          select: { inviteId: true, userId: true },
        });

        if (dupVerification) {
          // Only block if the prior verification is actually claimed by a real
          // account or a still-active onboarding. If the other invite was
          // deleted AND no user was ever linked, the verification is orphaned
          // (nobody owns this Aadhaar) — allow it through. A missing invite must
          // NOT be treated as "active", otherwise a user's own abandoned +
          // later-purged attempt permanently locks them out.
          const otherInvite = dupVerification.inviteId
            ? await prisma.invite.findUnique({
                where: { id: dupVerification.inviteId },
                select: { status: true },
              })
            : null;
          const isOtherActive =
            Boolean(dupVerification.userId) ||
            (otherInvite != null &&
              ["PENDING", "REGISTERED", "VERIFIED", "APPROVED"].includes(
                otherInvite.status
              ));

          if (isOtherActive) {
            return NextResponse.json(
              {
                ok: false,
                type: "AADHAAR_COMPLETE",
                message: "This Aadhaar is already linked to another NextGenPay account. Each Aadhaar can only be used once.",
                code: "AADHAAR_DUPLICATE",
              },
              { status: 409 }
            );
          }
        }
      }

      await prisma.verificationResult.create({
        data: {
          inviteId: invite.id,
          userId: invite.userId,
          type: "AADHAAR_DIGILOCKER",
          orderid,
          status: result.ok ? "Success" : "Failure",
          verifiedName: result.ok ? result.data.name : null,
          requestPayload: {
            verification_id: data.verification_id,
            reference_id: data.reference_id,
          },
          responsePayload: result.ok
            ? {
                name: result.data.name,
                uid: result.data.uid,
                dob: result.data.dob,
                gender: result.data.gender,
                address: result.data.address,
                split_address: result.data.split_address,
                aadhaarMobile,
              }
            : (result.raw as any),
        },
      });

      if (result.ok) {
        await prisma.invite.update({
          where: { id: invite.id },
          data: { aadhaarVerifiedAt: new Date() },
        });

        return NextResponse.json({
          ok: true,
          type: "AADHAAR_COMPLETE",
          data: {
            name: result.data.name,
            uid: result.data.uid,
            dob: result.data.dob,
            gender: result.data.gender,
            address: result.data.address,
            state: result.data.split_address?.state,
            pincode: result.data.split_address?.pincode,
            city: result.data.split_address?.dist,
            aadhaarMobile,
          },
        });
      }
      return NextResponse.json(
        { ok: false, type: "AADHAAR_COMPLETE", message: result.message },
        { status: 422 }
      );
    }
  }
}
