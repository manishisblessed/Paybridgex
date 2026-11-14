import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { toErrorResponse } from "@/lib/security/apiErrors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import { prisma } from "@/lib/db";
import { chagansCcCreateMerchant } from "@/lib/partners/chagans-cc-bill";
import { getBbpsMerchantStatus } from "@/lib/services/bbpsMerchant";
import { clientIp } from "@/lib/security/audit";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

/**
 * Map raw provider error messages/codes to user-friendly text.
 * NEVER expose internal partner names or raw provider strings to users.
 */
function friendlyMerchantError(
  code: string | undefined,
  rawMessage: string | undefined
): string {
  const msg = (rawMessage ?? "").toLowerCase();

  // Product not yet provisioned on the provider side.
  if (msg.includes("not enabled") || code === "403") {
    return "CC Bill Payment is currently being set up. Please try again later or contact support.";
  }

  // PAN already registered with a different mobile — user-actionable.
  if (msg.includes("pan") && msg.includes("already registered")) {
    return "This PAN is already registered with a different mobile number. Please use the same mobile number that was originally linked, or try with a different PAN.";
  }

  // Aadhaar already registered.
  if (msg.includes("aadhaar") && msg.includes("already registered")) {
    return "This Aadhaar is already registered. Please contact support.";
  }

  // Generic "already registered/duplicate" — provide clear guidance.
  if (msg.includes("already registered") || msg.includes("duplicate") || msg.includes("already exists")) {
    return "These details are already registered. Please contact support if you need help.";
  }

  // KYC validation failures — surface the specific field problem.
  if (msg.includes("aadhaar") || msg.includes("aadhar")) {
    return "Invalid Aadhaar number. Please enter a valid 12-digit Aadhaar.";
  }
  if (msg.includes("pan")) {
    return "Invalid PAN. Please enter a valid PAN (e.g. ABCDE1234F).";
  }
  if (msg.includes("mobile")) {
    return "Invalid mobile number. Please enter a valid 10-digit mobile.";
  }
  if (msg.includes("email")) {
    return "Invalid email address. Please check and try again.";
  }
  if (msg.includes("ifsc") || msg.includes("bank")) {
    return "Invalid bank details. Please check your account number and IFSC.";
  }
  if (msg.includes("kyc failed") || msg.includes("kyc rejected")) {
    return "KYC verification failed. Please check all your details are correct and try again.";
  }
  // Generic fallback.
  return "Merchant onboarding could not be completed. Please check your details and try again.";
}

// Validation matching Chagans requirements
const CreateMerchantBody = z
  .object({
    mobile: z.string().regex(/^\d{10}$/, "Mobile must be exactly 10 digits"),
    name: z.string().min(2, "Name is required").max(100),
    gender: z.enum(["M", "F", "O"]),
    pan: z
      .string()
      .regex(/^[A-Z]{5}\d{4}[A-Z]$/, "Invalid PAN format (e.g. ABCDE1234F)"),
    email: z.string().email("Invalid email"),
    address: z.object({
      full: z.string().min(5, "Full address is required"),
      city: z.string().min(2, "City is required"),
      pincode: z.string().regex(/^\d{6}$/, "Pincode must be 6 digits"),
    }),
    aadhaar: z.string().regex(/^\d{12}$/, "Aadhaar must be exactly 12 digits"),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD"),
    latitude: z.string().min(1),
    longitude: z.string().min(1),
    bankAccountNo: z.string().min(8, "Bank account number is required").max(20),
    bankIfsc: z
      .string()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code"),
  })
  .strict();

/**
 * GET /api/services/chagans-cc/merchant
 * Returns the user's BBPS merchant onboarding status.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    if (user.role !== "RETAILER")
      throw new AuthError("CC Bill Payment is available for retailers only", 403);

    const merchant = await getBbpsMerchantStatus(user.id);

    return NextResponse.json({
      merchant,
      canTransact: !!(
        merchant?.status === "ACTIVE" && merchant.providerMerchantId
      ),
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/**
 * POST /api/services/chagans-cc/merchant
 * Creates a new merchant via Chagans createMerchant API.
 * If the user already has an ACTIVE merchant, returns 409.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
    if (user.role !== "RETAILER")
      throw new AuthError("CC Bill Payment is available for retailers only", 403);
    await assertServiceEnabled(SERVICE_KEYS.BBPS_CHAGANS, {
      name: "CC Bill Payment",
      userId: user.id,
      role: user.role,
    });
    await enforceRateLimit(
      `chagans-merchant:create:${user.id}`,
      RATE_LIMITS.default
    );
  } catch (e) {
    return toErrorResponse(e);
  }

  const parsed = CreateMerchantBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );

  const d = parsed.data;

  try {
    // Check for existing merchant record
    const existing = await prisma.bbpsMerchant.findUnique({
      where: { userId: user.id },
    });

    if (existing?.status === "ACTIVE" && existing.providerMerchantId) {
      return NextResponse.json(
        {
          error: "You already have an active merchant account",
          merchantId: existing.providerMerchantId,
          status: existing.status,
        },
        { status: 409 }
      );
    }

    if (existing?.status === "PENDING") {
      return NextResponse.json(
        {
          error:
            "Your merchant onboarding is already in progress. Please wait for verification.",
          status: existing.status,
        },
        { status: 409 }
      );
    }

    // Call Chagans createMerchant
    const result = await chagansCcCreateMerchant({
      mobile: d.mobile,
      name: d.name,
      gender: d.gender,
      pan: d.pan,
      email: d.email,
      address: d.address,
      aadhaar: d.aadhaar,
      dateOfBirth: d.dateOfBirth,
      latitude: d.latitude,
      longitude: d.longitude,
      bankAccountNo: d.bankAccountNo,
      bankIfsc: d.bankIfsc,
    });

    // Full KYC payload stored in meta — all fields the user submitted.
    const kycMeta = {
      name: d.name,
      mobile: d.mobile,
      email: d.email,
      gender: d.gender,
      pan: d.pan,
      aadhaar: d.aadhaar,
      dateOfBirth: d.dateOfBirth,
      address: d.address,
      latitude: d.latitude,
      longitude: d.longitude,
      bankAccountNo: d.bankAccountNo,
      bankIfsc: d.bankIfsc,
    };

    if (!result.ok) {
      // If there's an existing REJECTED record, update it to PENDING for retry
      if (existing?.status === "REJECTED") {
        await prisma.bbpsMerchant.update({
          where: { id: existing.id },
          data: {
            status: "PENDING",
            meta: {
              ...kycMeta,
              lastAttempt: new Date().toISOString(),
              error: result.message,
              createdVia: "self-onboarding",
            },
          },
        });
      }

      return NextResponse.json(
        {
          error: friendlyMerchantError(result.code, result.message),
          code: result.code,
        },
        { status: 400 }
      );
    }

    // Success — upsert the merchant record with full KYC data
    const merchant = await prisma.bbpsMerchant.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        provider: "CHAGANS",
        providerMerchantId: result.data.merchantId,
        kycStatus: result.data.kycStatus,
        status: "ACTIVE",
        activatedAt: new Date(),
        meta: {
          ...kycMeta,
          chagansMerchantId: result.data.merchantId,
          createdVia: "self-onboarding",
          createdAt: new Date().toISOString(),
        },
      },
      update: {
        providerMerchantId: result.data.merchantId,
        kycStatus: result.data.kycStatus,
        status: "ACTIVE",
        activatedAt: new Date(),
        suspendedAt: null,
        meta: {
          ...kycMeta,
          chagansMerchantId: result.data.merchantId,
          createdVia: "self-onboarding",
          updatedAt: new Date().toISOString(),
        },
      },
    });

    // Audit log — includes all KYC fields for compliance
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "bbps.merchant_created",
        entity: "BbpsMerchant",
        entityId: merchant.id,
        meta: {
          merchantId: result.data.merchantId,
          kycStatus: result.data.kycStatus,
          provider: "CHAGANS",
          kyc: kycMeta,
        },
        ip: clientIp(req),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        merchantId: result.data.merchantId,
        kycStatus: result.data.kycStatus,
        status: "ACTIVE",
      },
      { status: 201 }
    );
  } catch (e) {
    return toErrorResponse(e);
  }
}
