import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getPartner } from "@/lib/partners";
import { assertPasswordNotBreached, BreachedPasswordError } from "@/lib/security/breachedPassword";
import { env } from "@/lib/env";
import { needsSuccessorApproval } from "@/lib/declaration/types";
import { getRequiredDocTypes, docTypeLabel } from "@/lib/onboarding/requiredDocuments";
import { generateNextUserCode } from "@/lib/userCode";

const RegisterBody = z.object({
  name: z.string().min(2).max(100),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(20, "Password must be at most 20 characters")
    .refine(
      (pwd) => /[A-Za-z]/.test(pwd) && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd),
      "Password must include letters, numbers, and a special character"
    ),
  shopName: z.string().min(1),
  shopAddress: z.string().optional(),
  city: z.string().optional(),
  state: z.string().min(2),
  pincode: z.string().length(6),
  panNumber: z.string().length(10).regex(/^[A-Z]{5}\d{4}[A-Z]$/).optional(),
  panName: z.string().optional(),
  aadhaarLast4: z.string().length(4).regex(/^\d{4}$/).optional(),
  aadhaarNumber: z.string().optional(),
  aadhaarName: z.string().optional(),
  aadhaarDob: z.string().optional(),
  aadhaarGender: z.string().optional(),
  aadhaarAddress: z.string().optional(),
  aadhaarMobile: z.string().optional(),
  bankAccountNumber: z.string().min(8).max(20).optional(),
  bankIfsc: z.string().length(11).optional(),
  bankName: z.string().optional(),
  bankAccountStatus: z.string().optional(),
  gstin: z.string().length(15).optional(),
  msmeNumber: z.string().optional(),
  nameMismatch: z.boolean().default(false),
  nameDeclarationAccepted: z.boolean().default(false),
  dob: z.string().optional(),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  }

  if (!["PENDING", "REGISTERED"].includes(invite.status)) {
    return NextResponse.json(
      { error: "This invite is no longer accepting registration" },
      { status: 400 }
    );
  }

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 400 });
  }

  if (!invite.phoneVerifiedAt) {
    return NextResponse.json(
      { error: "Please verify your mobile number before registering" },
      { status: 400 }
    );
  }

  if (!invite.emailVerifiedAt) {
    return NextResponse.json(
      { error: "Please verify your email address before registering" },
      { status: 400 }
    );
  }

  const parsed = RegisterBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  function parseDob(raw?: string): Date | undefined {
    if (!raw) return undefined;
    // Handle dd-mm-yyyy or dd/mm/yyyy from Aadhaar
    const ddmmyyyy = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (ddmmyyyy) {
      const d = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
      if (!isNaN(d.getTime())) return d;
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? undefined : d;
  }

  try {
    await assertPasswordNotBreached(data.password);
  } catch (e) {
    if (e instanceof BreachedPasswordError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email: invite.email }, { phone: invite.phone }] },
  });

  if (existingUser && invite.userId !== existingUser.id) {
    return NextResponse.json(
      { error: "A user with this email or phone already exists" },
      { status: 409 }
    );
  }

  // ── Fraud gate: enforce one-identity-per-user across all KYC & shop fields ──
  const excludeUserId = invite.userId ?? undefined;

  const duplicateChecks: { field: string; value: string | undefined; model: "kyc" | "user" }[] = [
    { field: "panNumber", value: data.panNumber?.toUpperCase(), model: "kyc" },
    { field: "aadhaarNumber", value: data.aadhaarNumber, model: "kyc" },
    { field: "bankAccountNumber", value: data.bankAccountNumber, model: "kyc" },
    { field: "gstin", value: data.gstin?.toUpperCase(), model: "kyc" },
    { field: "msmeNumber", value: data.msmeNumber, model: "kyc" },
    { field: "shopName", value: data.shopName, model: "user" },
  ];

  const fieldLabels: Record<string, string> = {
    panNumber: "PAN number",
    aadhaarNumber: "Aadhaar number",
    bankAccountNumber: "bank account number",
    gstin: "GST number",
    msmeNumber: "Udyam number",
    shopName: "shop name",
  };

  for (const { field, value, model } of duplicateChecks) {
    if (!value) continue;

    if (model === "kyc") {
      const dup = await prisma.kyc.findFirst({
        where: {
          [field]: value,
          ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
        },
        select: { userId: true },
      });
      if (dup) {
        return NextResponse.json(
          { error: `Another account is already registered with this ${fieldLabels[field]}` },
          { status: 409 }
        );
      }
    } else {
      const dup = await prisma.user.findFirst({
        where: {
          [field]: value,
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
        select: { id: true },
      });
      if (dup) {
        return NextResponse.json(
          { error: `Another account is already registered with this ${fieldLabels[field]}` },
          { status: 409 }
        );
      }
    }
  }

  // Aadhaar last-4 fallback: catch legacy records where aadhaarNumber is NULL
  if (data.aadhaarNumber) {
    const last4 = data.aadhaarNumber.slice(-4);
    const dupLast4 = await prisma.kyc.findFirst({
      where: {
        aadhaarLast4: last4,
        aadhaarNumber: null,
        ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      },
      select: { userId: true },
    });
    if (dupLast4) {
      return NextResponse.json(
        { error: "Another account is already registered with this Aadhaar number" },
        { status: 409 }
      );
    }
  }

  const verifications = await prisma.verificationResult.findMany({
    where: { inviteId: invite.id },
    select: { type: true, status: true },
  });
  const verifiedTypes = new Set(
    verifications.filter((v) => v.status === "Success").map((v) => v.type)
  );
  const uploadedDocTypes = new Set(
    verifications
      .filter((v) => v.status === "Uploaded" && v.type.startsWith("DOCUMENT_"))
      .map((v) => v.type.replace("DOCUMENT_", ""))
  );

  const hasAadhaar = verifiedTypes.has("AADHAAR_DIGILOCKER");
  const hasPan = verifiedTypes.has("PAN_360");
  const hasBank = verifiedTypes.has("BANK_PENNY_DROP") || verifiedTypes.has("BANK_ADVANCE");

  const uploadedDocsList = Array.from(uploadedDocTypes);
  const hasSelfie = uploadedDocTypes.has("SELFIE");

  // ── Server-side onboarding gate ─────────────────────────────────────────
  // The wizard blocks progression client-side, but registration is a public,
  // token-based endpoint — so we must re-enforce every mandatory step here to
  // prevent a crafted request from bypassing KYC, documents, the signed
  // self-declaration, or the successor's responsibility approval.
  const gateErrors: string[] = [];

  if (!hasPan) gateErrors.push("PAN verification is incomplete");
  if (!hasAadhaar) gateErrors.push("Aadhaar verification is incomplete");
  if (!hasBank) gateErrors.push("Bank verification is incomplete");
  if (!hasSelfie) gateErrors.push("Live selfie is missing");

  for (const docType of getRequiredDocTypes(invite.role)) {
    if (!uploadedDocTypes.has(docType)) {
      gateErrors.push(`${docTypeLabel(docType)} is missing`);
    }
  }

  if (!uploadedDocTypes.has("SELF_DECLARATION")) {
    gateErrors.push("Signed self-declaration is missing");
  }

  // Successor (upline) responsibility approval, when required by hierarchy.
  const inviter = await prisma.user.findUnique({
    where: { id: invite.invitedById },
    select: { role: true },
  });

  const requiresSuccessorApproval = inviter
    ? needsSuccessorApproval(invite.role, inviter.role)
    : false;

  if (requiresSuccessorApproval) {
    const approval = await prisma.declarationApproval.findFirst({
      where: { inviteId: invite.id },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    if (!approval) {
      gateErrors.push(
        "Your upline's declaration approval has not been requested yet"
      );
    } else if (approval.status !== "APPROVED") {
      gateErrors.push(
        `Your upline's declaration approval is ${approval.status.toLowerCase()} — it must be approved before you can register`
      );
    }
  }

  // When the applicant's Aadhaar/PAN/Bank names don't match, they must
  // explicitly self-declare (via the onboarding popup) that all names belong to
  // them. Without that acknowledgement we cannot accept the submission.
  if (data.nameMismatch && !data.nameDeclarationAccepted) {
    gateErrors.push(
      "Please confirm the name declaration for your Aadhaar, PAN and bank records"
    );
  }

  if (gateErrors.length > 0) {
    return NextResponse.json(
      {
        error:
          "Onboarding is not complete. Please finish all required steps before registering.",
        details: gateErrors,
      },
      { status: 400 }
    );
  }

  const allVerified = hasPan && hasAadhaar && hasBank && !data.nameMismatch && hasSelfie;
  const newStatus = allVerified ? "VERIFIED" : "REGISTERED";

  // A declared name mismatch is a valid submission that simply needs manual
  // admin approval — it must land in the KYC review queue (PENDING_REVIEW),
  // not sit at NOT_STARTED where admins can't action it.
  const nameDeclarationAccepted = data.nameMismatch && data.nameDeclarationAccepted;
  const kycStatus =
    allVerified || nameDeclarationAccepted ? "PENDING_REVIEW" : "NOT_STARTED";
  const nameDeclarationAt = nameDeclarationAccepted ? new Date() : undefined;

  const result = await prisma.$transaction(async (tx) => {
    let user;
    if (invite.userId && existingUser) {
      user = await tx.user.update({
        where: { id: invite.userId },
        data: {
          name: data.name,
          passwordHash,
          shopName: data.shopName,
          shopAddress: data.shopAddress,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          phoneVerifiedAt: invite.phoneVerifiedAt,
          emailVerifiedAt: invite.emailVerifiedAt,
        },
      });
    } else {
      const userCode = await generateNextUserCode(invite.role);
      user = await tx.user.create({
        data: {
          name: data.name,
          email: invite.email,
          phone: invite.phone,
          passwordHash,
          role: invite.role,
          status: "PENDING_KYC",
          userCode,
          parentId: invite.parentId,
          shopName: data.shopName,
          shopAddress: data.shopAddress,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          phoneVerifiedAt: invite.phoneVerifiedAt,
          emailVerifiedAt: invite.emailVerifiedAt,
        },
      });
    }

    await tx.kyc.upsert({
      where: { userId: user.id },
      update: {
        panNumber: data.panNumber?.toUpperCase(),
        panName: data.panName,
        aadhaarLast4: data.aadhaarLast4,
        aadhaarNumber: data.aadhaarNumber,
        aadhaarName: data.aadhaarName,
        aadhaarDob: data.aadhaarDob,
        aadhaarGender: data.aadhaarGender,
        aadhaarAddress: data.aadhaarAddress,
        aadhaarMobile: data.aadhaarMobile,
        bankAccountName: data.bankName,
        bankAccountNumber: data.bankAccountNumber,
        bankIfsc: data.bankIfsc?.toUpperCase(),
        bankAccountStatus: data.bankAccountStatus,
        gstin: data.gstin?.toUpperCase(),
        msmeNumber: data.msmeNumber || undefined,
        nameMismatch: data.nameMismatch,
        nameDeclarationAccepted,
        nameDeclarationAt,
        dob: parseDob(data.dob),
    panVerifiedAt: hasPan ? new Date() : undefined,
    aadhaarVerifiedAt: hasAadhaar ? new Date() : undefined,
    status: kycStatus,
    submittedAt: new Date(),
  },
  create: {
    userId: user.id,
    panNumber: data.panNumber?.toUpperCase(),
    panName: data.panName,
    aadhaarLast4: data.aadhaarLast4,
    aadhaarNumber: data.aadhaarNumber,
    aadhaarName: data.aadhaarName,
    aadhaarDob: data.aadhaarDob,
    aadhaarGender: data.aadhaarGender,
    aadhaarAddress: data.aadhaarAddress,
    aadhaarMobile: data.aadhaarMobile,
    bankAccountName: data.bankName,
    bankAccountNumber: data.bankAccountNumber,
    bankIfsc: data.bankIfsc?.toUpperCase(),
    bankAccountStatus: data.bankAccountStatus,
    gstin: data.gstin?.toUpperCase(),
    msmeNumber: data.msmeNumber || undefined,
    nameMismatch: data.nameMismatch,
    nameDeclarationAccepted,
    nameDeclarationAt,
    dob: parseDob(data.dob),
        panVerifiedAt: hasPan ? new Date() : undefined,
        aadhaarVerifiedAt: hasAadhaar ? new Date() : undefined,
        status: kycStatus,
        submittedAt: new Date(),
      },
    });

    await tx.invite.update({
      where: { id: invite.id },
      data: {
        status: newStatus as any,
        userId: user.id,
        name: data.name,
        registeredAt: new Date(),
        verifiedAt: allVerified ? new Date() : undefined,
      },
    });

    await tx.verificationResult.updateMany({
      where: { inviteId: invite.id },
      data: { userId: user.id },
    });

    return user;
  });

  await prisma.auditLog.create({
    data: {
      userId: result.id,
      action: "onboard.registered",
      entity: "Invite",
      entityId: invite.id,
      meta: {
        role: invite.role,
        verifiedTypes: Array.from(verifiedTypes),
        uploadedDocs: uploadedDocsList,
        hasSelfie,
        allVerified,
        nameMismatch: data.nameMismatch,
        nameDeclarationAccepted,
      },
    },
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const loginUrl = `${appUrl}/login`;

  // ── Notify the admin who sent the invite ──
  try {
    const inviter = await prisma.user.findUnique({
      where: { id: invite.invitedById },
      select: { id: true, email: true, name: true, role: true },
    });

    if (inviter) {
      await prisma.notification.create({
        data: {
          userId: inviter.id,
          title: "New Registration Pending Approval",
          body: `${data.name} (${invite.role.replace(/_/g, " ")}) has completed onboarding and is awaiting your approval. Phone: ${invite.phone}, Email: ${invite.email}.`,
          channel: "INAPP",
        },
      });

      const emailProvider = getPartner("email");
      await emailProvider.send({
        to: inviter.email,
        subject: `Paybridgex — New Registration: ${data.name} awaits approval`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;">
            <h1 style="color:#1e293b;font-size:22px;margin:0 0 16px;">New Registration Awaiting Approval</h1>
            <p>Hi <strong>${inviter.name}</strong>,</p>
            <p><strong>${data.name}</strong> has completed their onboarding as a <strong>${invite.role.replace(/_/g, " ")}</strong> and is now pending your approval.</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:20px 0;">
              <h3 style="margin:0 0 12px 0;color:#334155;font-size:16px;">Applicant Details</h3>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:6px 0;color:#64748b;width:120px;">Name</td><td style="padding:6px 0;font-weight:600;">${data.name}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;">Role</td><td style="padding:6px 0;font-weight:600;">${invite.role.replace(/_/g, " ")}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;">Phone</td><td style="padding:6px 0;font-weight:600;">${invite.phone}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;">Email</td><td style="padding:6px 0;font-weight:600;">${invite.email}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;">KYC Status</td><td style="padding:6px 0;font-weight:600;">${allVerified ? "All Verified" : "Pending Review"}</td></tr>
              </table>
            </div>
            <div style="text-align:center;margin:24px 0;">
              <a href="${appUrl}/dashboard" style="display:inline-block;padding:14px 32px;background:#1b45ea;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">View in Dashboard</a>
            </div>
            <p style="color:#64748b;font-size:13px;">${["MASTER_ADMIN", "ADMIN", "SUPPORT"].includes(inviter.role) ? "Please review and approve within 48–72 working hours." : "An admin will review and activate the account within 48–72 working hours."}</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
            <p style="color:#94a3b8;font-size:12px;text-align:center;">Paybridgex — K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED</p>
          </div>
        `,
      });
    }
  } catch {
    // Admin notification failure shouldn't block registration
  }

  // ── Confirmation email to the registrant ──
  try {
    const roleLabel = invite.role
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    const firstName = data.name.trim().split(/\s+/)[0] || data.name || "there";
    const year = new Date().getFullYear();
    const statusAccent = allVerified ? "#059669" : "#d97706";
    const statusBg = allVerified ? "#ecfdf5" : "#fffbeb";
    const statusBorder = allVerified ? "#a7f3d0" : "#fde68a";
    const statusTitle = allVerified ? "Account under review" : "Awaiting admin approval";
    const statusMessage = allVerified
      ? "All your KYC checks have passed. Your account will be activated within 48\u201372 working hours, and you'll receive a confirmation email as soon as it goes live."
      : "Some of your details need a manual review by our team. You'll receive another email as soon as your account is approved.";

    const nextSteps = [
      { n: "1", t: "KYC & documents review", d: "Our compliance team is reviewing your submission." },
      { n: "2", t: "Approval within 48\u201372 hrs", d: "You'll be notified by email and SMS the moment it's approved." },
      { n: "3", t: "Start transacting", d: "Log in to your dashboard and go live with Paybridgex services." },
    ];
    const nextStepsHtml = nextSteps
      .map(
        (r) => `
                  <tr>
                    <td width="44" valign="top" style="padding:8px 14px 8px 0;">
                      <div style="width:32px;height:32px;line-height:32px;text-align:center;border-radius:999px;background:#eef2ff;color:#1b45ea;font-weight:700;font-size:13px;">${r.n}</div>
                    </td>
                    <td valign="top" style="padding:8px 0;">
                      <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;">${r.t}</p>
                      <p style="margin:2px 0 0;font-size:13px;line-height:1.5;color:#64748b;">${r.d}</p>
                    </td>
                  </tr>`
      )
      .join("");

    const emailProvider = getPartner("email");
    await emailProvider.send({
      to: invite.email,
      subject: `Welcome to Paybridgex, ${firstName} \u2014 you're onboarded!`,
      html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Welcome to Paybridgex</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0f172a;">
    <div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
      You're onboarded! Sign in to your Paybridgex ${roleLabel} account.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);">
            <tr>
              <td style="background:#1b45ea;background-image:linear-gradient(135deg,#1b45ea 0%,#7c3aed 100%);padding:36px 32px;text-align:center;">
                <div style="display:inline-block;padding:6px 14px;background:rgba(255,255,255,0.18);border-radius:999px;font-size:11px;font-weight:700;letter-spacing:1.4px;color:#ffffff;text-transform:uppercase;">
                  Paybridgex
                </div>
                <h1 style="margin:18px 0 6px;font-size:26px;line-height:1.25;color:#ffffff;font-weight:700;">You're all set, ${firstName}!</h1>
                <p style="margin:0;font-size:14px;color:#e0e7ff;">Your ${roleLabel} onboarding is complete.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
                  Dear <strong style="color:#0f172a;">${data.name}</strong>,
                </p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">
                  Thank you for choosing <strong>Paybridgex</strong>. We've successfully received your KYC, documents and business details for your <strong>${roleLabel}</strong> account.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background:${statusBg};border:1px solid ${statusBorder};border-left:4px solid ${statusAccent};border-radius:12px;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${statusAccent};text-transform:uppercase;letter-spacing:0.6px;">${statusTitle}</p>
                      <p style="margin:0;font-size:14px;line-height:1.55;color:#334155;">${statusMessage}</p>
                    </td>
                  </tr>
                </table>
                <h3 style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;">Your login credentials</h3>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                  <tr>
                    <td style="padding:6px 18px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="padding:12px 0;color:#64748b;font-size:13px;width:110px;">Email</td>
                          <td style="padding:12px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${invite.email}</td>
                        </tr>
                        <tr>
                          <td style="padding:12px 0;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Phone</td>
                          <td style="padding:12px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;border-top:1px solid #e2e8f0;">${invite.phone}</td>
                        </tr>
                        <tr>
                          <td style="padding:12px 0;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Password</td>
                          <td style="padding:12px 0;color:#475569;font-size:13px;font-style:italic;text-align:right;border-top:1px solid #e2e8f0;">The one you set during registration</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
                  <tr>
                    <td align="center">
                      <a href="${loginUrl}" style="display:inline-block;padding:14px 34px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;background:#1b45ea;box-shadow:0 4px 12px rgba(79,70,229,0.35);">
                        Login to your dashboard &rarr;
                      </a>
                      <p style="margin:14px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">Trouble with the button? Paste this into your browser:<br /><a href="${loginUrl}" style="color:#1b45ea;text-decoration:none;">${loginUrl}</a></p>
                    </td>
                  </tr>
                </table>
                <h3 style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;">What happens next</h3>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">${nextStepsHtml}
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;background:#f8fafc;border-radius:10px;">
                  <tr>
                    <td style="padding:16px 18px;font-size:13px;line-height:1.6;color:#475569;">
                      <strong style="color:#0f172a;">Need help?</strong> Our team is a message away at <a href="mailto:support@paybridgex.in" style="color:#1b45ea;font-weight:600;text-decoration:none;">support@paybridgex.in</a>. If you did not initiate this registration, please reach out to us immediately.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px;background:#0f172a;color:#94a3b8;font-size:12px;line-height:1.6;text-align:center;">
                <p style="margin:0 0 4px;color:#f1f5f9;font-weight:700;letter-spacing:0.4px;">Paybridgex</p>
                <p style="margin:0 0 10px;color:#cbd5e1;">K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED</p>
                <p style="margin:0;color:#64748b;">&copy; ${year} Paybridgex. All rights reserved.<br />This is an automated message &mdash; please do not reply.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    });
  } catch {
    // Email failure shouldn't block registration
  }

  try {
    const smsProvider = getPartner("sms");
    await smsProvider.sendTransactional({
      phone: invite.phone,
      templateId: "onboard_success",
      variables: {
        name: data.name,
        role: invite.role.replace(/_/g, " "),
      },
    });
  } catch {
    // SMS failure shouldn't block registration
  }

  return NextResponse.json({
    ok: true,
    status: newStatus,
    user: {
      id: result.id,
      name: result.name,
      email: result.email,
      role: result.role,
      status: result.status,
    },
    message: allVerified
      ? "Registration complete. Awaiting admin approval."
      : "Registration saved. Your documents are under review for admin approval.",
  });
}
