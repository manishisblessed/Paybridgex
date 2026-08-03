import { nanoid } from "nanoid";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { maskTail } from "../crypto/fieldEncryption";
import { logSecurityEvent } from "../security/audit";
import { isNetworkTier, isReKycDue } from "../security/kycGate";
import { firstOfNextMonthIST } from "./dates";
import {
  reKycMethod,
  methodRequiresAadhaar,
  methodRequiresFace,
  faceMatchThreshold,
  type ReKycMethod,
} from "./config";
import {
  initiateAadhaarDigilocker,
  completeAadhaarDigilocker,
  matchFace,
  rekycLive,
  rekycProviderName,
} from "./provider";
import { getFaceBaselineRef, encryptBaselineRef } from "./face";

/**
 * Monthly Re-KYC orchestration (Phase 13).
 *
 * initiate → opens a PENDING attempt and (for Aadhaar methods) creates a
 * DigiLocker session, returning the redirect URL and stashing the DigiLocker
 * verification/reference ids on the attempt. verify → after the user returns
 * from DigiLocker, pulls the verified Aadhaar document (and/or a liveness
 * probe), confirms it matches the account's on-file Aadhaar, and on success
 * clears the gate, advances the due date to the 1st of next month, and marks
 * the attempt PASSED. No raw Aadhaar/biometric ever touches our DB — only
 * masked values + opaque provider references.
 */

export class ReKycError extends Error {
  constructor(message: string, public statusCode: number, public code: string) {
    super(message);
    this.name = "ReKycError";
  }
}

type Ctx = { ip?: string | null; userAgent?: string | null };

export type ReKycStatus = {
  reKycRequired: boolean;
  reKycDueAt: string | null;
  lastReKycAt: string | null;
  isNetworkTier: boolean;
  exempt: boolean;
  method: ReKycMethod;
};

export async function getReKycStatus(user: {
  id: string;
  role: string;
}): Promise<ReKycStatus> {
  const network = isNetworkTier(user.role);
  const row = network
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          reKycRequired: true,
          reKycDueAt: true,
          lastReKycAt: true,
          reKycExempt: true,
        },
      })
    : null;

  // Due-date aware: a scheduled day that has arrived counts as required even if
  // the flag was not yet raised (keeps the page + gate modal in sync with the
  // transaction gate, which lazily flips the flag on the next money route).
  // A master-admin exemption always wins.
  const required =
    network && !row?.reKycExempt
      ? isReKycDue(!!row?.reKycRequired, row?.reKycDueAt ?? null)
      : false;

  return {
    reKycRequired: required,
    reKycDueAt: row?.reKycDueAt?.toISOString() ?? null,
    lastReKycAt: row?.lastReKycAt?.toISOString() ?? null,
    isNetworkTier: network,
    exempt: network ? !!row?.reKycExempt : false,
    method: reKycMethod(),
  };
}

export type InitiateResult = {
  logId: string;
  method: ReKycMethod;
  requiresAadhaar: boolean;
  requiresFace: boolean;
  needsBaselineEnrollment: boolean;
  provider: string;
  /** DigiLocker redirect URL when the method includes Aadhaar; null otherwise. */
  digilockerUrl: string | null;
};

export async function initiateReKyc(
  user: { id: string; role: string },
  input: { redirectUrl?: string },
  ctx: Ctx
): Promise<InitiateResult> {
  if (!isNetworkTier(user.role)) {
    throw new ReKycError("Re-KYC does not apply to this role.", 400, "NOT_NETWORK_TIER");
  }

  const method = reKycMethod();
  const provider = rekycProviderName();
  const orderid = `REKYC${nanoid(18).toUpperCase()}`;
  const requiresAadhaar = methodRequiresAadhaar(method);
  const requiresFace = methodRequiresFace(method);

  // Open a DigiLocker Aadhaar session up-front — same flow as onboarding. The
  // ids are stashed on the attempt so /verify can pull the document after the
  // user returns from DigiLocker (the client never has to hold them).
  let digilockerUrl: string | null = null;
  let verificationId: string | null = null;
  let referenceId: string | null = null;
  if (requiresAadhaar) {
    const redirectUrl = (input.redirectUrl ?? "").trim();
    // Keep the redirect URL clean (no query string) — a nested query trips the
    // eKYC Hub WAF and returns a 403 (same rule as onboarding).
    if (!/^https?:\/\/[^?#]+$/.test(redirectUrl)) {
      throw new ReKycError("A valid return URL is required.", 400, "REDIRECT_URL_INVALID");
    }
    const res = await initiateAadhaarDigilocker({ redirectUrl, orderid });
    if (!res.ok) {
      throw new ReKycError(
        res.message || "Could not start Aadhaar verification.",
        502,
        "PROVIDER_INIT_FAILED"
      );
    }
    digilockerUrl = res.url;
    verificationId = res.verificationId;
    referenceId = res.referenceId;
  }

  const needsBaselineEnrollment = requiresFace
    ? (await getFaceBaselineRef(user.id)) === null
    : false;

  const log = await prisma.reKycLog.create({
    data: {
      userId: user.id,
      method,
      status: "PENDING",
      provider,
      providerRef: referenceId,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      meta: {
        orderid,
        requiresAadhaar,
        requiresFace,
        needsBaselineEnrollment,
        verificationId,
        referenceId,
      } as Prisma.InputJsonValue,
    },
  });

  await logSecurityEvent({
    action: "rekyc.initiated",
    severity: "info",
    userId: user.id,
    entity: "ReKycLog",
    entityId: log.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    meta: { method, provider, requiresAadhaar, requiresFace, needsBaselineEnrollment },
  });

  return {
    logId: log.id,
    method,
    requiresAadhaar,
    requiresFace,
    needsBaselineEnrollment,
    provider,
    digilockerUrl,
  };
}

export type VerifyResult = {
  passed: true;
  reKycDueAt: string;
  enrolledBaseline: boolean;
};

export async function verifyReKyc(
  user: { id: string; role: string },
  input: { faceProbeRef?: string },
  ctx: Ctx
): Promise<VerifyResult> {
  if (!isNetworkTier(user.role)) {
    throw new ReKycError("Re-KYC does not apply to this role.", 400, "NOT_NETWORK_TIER");
  }

  // The active attempt is the most recent PENDING log opened by /initiate.
  const log = await prisma.reKycLog.findFirst({
    where: { userId: user.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!log) {
    throw new ReKycError("No active re-KYC request. Start verification again.", 409, "NO_PENDING_REKYC");
  }

  const meta = (log.meta as Record<string, unknown> | null) ?? {};
  const method = log.method as ReKycMethod;
  const orderid = String(meta.orderid ?? log.id);
  const requiresAadhaar = methodRequiresAadhaar(method);
  const requiresFace = methodRequiresFace(method);

  const resultMeta: Record<string, unknown> = { ...meta };

  // ── Fail helper: mark the attempt FAILED, keep the gate closed, surface code.
  const fail = async (message: string, code: string, statusCode = 422): Promise<never> => {
    await prisma.reKycLog.update({
      where: { id: log.id },
      data: { status: "FAILED", meta: { ...resultMeta, failureCode: code } as Prisma.InputJsonValue },
    });
    await logSecurityEvent({
      action: "rekyc.failed",
      severity: "warn",
      userId: user.id,
      entity: "ReKycLog",
      entityId: log.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      meta: { method, code },
    });
    throw new ReKycError(message, statusCode, code);
  };

  // ── Factor 1: Aadhaar (DigiLocker) ─────────────────────────────────────
  if (requiresAadhaar) {
    const verificationId = typeof meta.verificationId === "string" ? meta.verificationId : null;
    const referenceId =
      (typeof meta.referenceId === "string" ? meta.referenceId : null) ?? log.providerRef ?? null;
    if (!verificationId || !referenceId) {
      await fail("Re-KYC session expired. Please restart.", "MISSING_REFERENCE", 409);
    }

    const res = await completeAadhaarDigilocker({
      verificationId: verificationId!,
      referenceId: referenceId!,
      orderid,
    });
    if (!res.ok) {
      await fail(res.message || "Aadhaar verification failed.", res.code || "AADHAAR_FAILED");
    }

    if (res.ok) {
      // Confirm it is the SAME person: the DigiLocker Aadhaar must match the
      // account's on-file Aadhaar. Skipped off the live path (simulated docs
      // carry no uid) and on the first cycle for legacy accounts with no
      // Aadhaar on record.
      if (rekycLive()) {
        const kyc = await prisma.kyc.findUnique({
          where: { userId: user.id },
          select: { aadhaarNumber: true, aadhaarLast4: true },
        });
        const uid = (res.uid ?? "").replace(/\s/g, "");
        const uidLast4 = uid ? uid.slice(-4) : null;
        const onFileFull = kyc?.aadhaarNumber ?? null;
        const onFileLast4 = kyc?.aadhaarLast4 ?? null;
        const hasOnFile = Boolean(onFileFull || onFileLast4);

        if (hasOnFile && uid) {
          const matches = onFileFull
            ? uid === onFileFull || (uidLast4 != null && uidLast4 === onFileLast4)
            : uidLast4 != null && uidLast4 === onFileLast4;
          if (!matches) {
            await fail(
              "This Aadhaar does not match the one on your account.",
              "AADHAAR_MISMATCH"
            );
          }
        }
      }

      // Store ONLY masked identity — never the raw Aadhaar.
      resultMeta.verifiedName = res.name;
      resultMeta.maskedAadhaar = res.uid ? maskTail(res.uid, 4) : null;
    }
  }

  // ── Factor 2: liveness face (match vs. baseline, or enroll on first cycle) ─
  let enrolledBaseline = false;
  if (requiresFace) {
    const probeRef = (input.faceProbeRef ?? "").trim();
    if (!probeRef) {
      await fail("A fresh liveness capture is required.", "FACE_PROBE_REQUIRED", 400);
    }

    const baselineRef = await getFaceBaselineRef(user.id);
    if (!baselineRef) {
      // Legacy / first cycle: enroll the fresh probe AS the baseline (Task 7).
      resultMeta.faceBaselineRefEnc = encryptBaselineRef(probeRef);
      resultMeta.faceEnrolled = true;
      enrolledBaseline = true;
    } else {
      const res = await matchFace({ baselineRef, probeRef, orderid });
      if (!res.ok) {
        await fail(res.message || "Face match failed.", res.code || "FACE_MATCH_FAILED");
      }
      if (res.ok) {
        resultMeta.faceConfidence = res.confidence;
        if (!res.match || res.confidence < faceMatchThreshold()) {
          await fail("Face did not match our records.", "FACE_MISMATCH");
        }
        // Carry the baseline forward so future months keep matching.
        resultMeta.faceBaselineRefEnc = encryptBaselineRef(baselineRef);
      }
    }
  }

  // ── Success: clear the gate and advance the due date to next month. ──────
  const nextDue = firstOfNextMonthIST();
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { reKycRequired: false, lastReKycAt: new Date(), reKycDueAt: nextDue },
    }),
    prisma.reKycLog.update({
      where: { id: log.id },
      data: { status: "PASSED", meta: resultMeta as Prisma.InputJsonValue },
    }),
    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "rekyc.passed",
        entity: "ReKycLog",
        entityId: log.id,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        meta: {
          method,
          provider: log.provider,
          enrolledBaseline,
          reKycDueAt: nextDue.toISOString(),
        },
      },
    }),
  ]);

  await logSecurityEvent({
    action: "rekyc.passed",
    severity: "info",
    userId: user.id,
    entity: "ReKycLog",
    entityId: log.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    persist: false, // AuditLog row already written in the transaction above
    meta: { method, enrolledBaseline, reKycDueAt: nextDue.toISOString() },
  });

  return { passed: true, reKycDueAt: nextDue.toISOString(), enrolledBaseline };
}
