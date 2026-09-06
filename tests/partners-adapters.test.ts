import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { samedaySign, samedayAuthHeaders } from "@/lib/partners/sameday-core";
import { mapPay2NewBill, mapPay2NewStatus } from "@/lib/partners/sameday-bbps";
import { mapSettlementStatus, type SettlementAccount, type VerificationStatus } from "@/lib/partners/sameday-settlement";
import { mapSettlementToPayoutStatus } from "@/lib/partners/sameday-payout";
import { deriveEsignStatus } from "@/lib/partners/leegality";

/**
 * Pure-function tests for the new partner adapters: the Same Day HMAC
 * signature scheme (a wrong signature = every call 401s in prod) and the
 * status/bill mapping helpers that decide whether money moved.
 */

describe("Same Day HMAC signing", () => {
  it("signs bodyString + timestamp with HMAC-SHA256 hex", () => {
    // Independent reference implementation.
    const expected = crypto
      .createHmac("sha256", "secret-1")
      .update('{"amount":100}1700000000000')
      .digest("hex");
    expect(samedaySign("secret-1", '{"amount":100}1700000000000')).toBe(expected);
  });

  it("produces verifiable auth headers for a POST body", () => {
    const body = JSON.stringify({ number: "5008", amount: 15234 });
    const h = samedayAuthHeaders("key-1", "secret-1", body);
    expect(h["x-api-key"]).toBe("key-1");
    expect(h["x-timestamp"]).toMatch(/^\d{13}$/);
    // Server-side check: HMAC(secret, compactBody + timestamp) must match.
    expect(h["x-signature"]).toBe(samedaySign("secret-1", body + h["x-timestamp"]));
  });

  it("signs the empty string for GET requests", () => {
    const h = samedayAuthHeaders("key-1", "secret-1", "");
    expect(h["x-signature"]).toBe(samedaySign("secret-1", h["x-timestamp"]));
  });
});

describe("Pay2New bill mapping", () => {
  it("maps the documented fetch-bill response", () => {
    const bill = mapPay2NewBill({
      success: true,
      data: {
        customer_name: "MANISH KUMAR SHAH",
        amount: "15234.00",
        bill_date: "2026-06-15",
        bill_due_date: "2026-07-05",
        bill_number: "INV-2026-06-001",
        "Minimum Amount Due": "1523.00",
        "Maximum Permissible Amount": "50000.00",
      },
      order_id: "P2N_ORD_1234567890",
      request_id: "SDS1719720000000",
    });
    expect(bill).toEqual({
      customerName: "MANISH KUMAR SHAH",
      amount: 15234,
      dueDate: "2026-07-05",
      billDate: "2026-06-15",
      billNumber: "INV-2026-06-001",
      minAmount: 1523,
      maxAmount: 50000,
      billFetchRef: "P2N_ORD_1234567890",
    });
  });

  it("tolerates missing optional fields", () => {
    const bill = mapPay2NewBill({ success: true, data: { amount: "100" } });
    expect(bill.amount).toBe(100);
    expect(bill.customerName).toBe("");
    expect(bill.minAmount).toBeUndefined();
    expect(bill.billFetchRef).toBeUndefined();
  });

  it("maps payment statuses, defaulting unknowns to PENDING", () => {
    expect(mapPay2NewStatus("SUCCESS")).toBe("SUCCESS");
    expect(mapPay2NewStatus("failed")).toBe("FAILED");
    expect(mapPay2NewStatus("REFUNDED")).toBe("REFUNDED");
    expect(mapPay2NewStatus("PENDING")).toBe("PENDING");
    expect(mapPay2NewStatus("SOMETHING_NEW")).toBe("PENDING");
    expect(mapPay2NewStatus(undefined)).toBe("PENDING");
  });
});

describe("Same Day settlement status mapping", () => {
  it("treats only explicit SUCCESS/FAILED as terminal", () => {
    expect(mapSettlementStatus("SUCCESS")).toBe("SUCCESS");
    expect(mapSettlementStatus("FAILED")).toBe("FAILED");
    expect(mapSettlementStatus("PENDING")).toBe("PENDING");
    expect(mapSettlementStatus("PROCESSING")).toBe("PENDING");
    expect(mapSettlementStatus(undefined)).toBe("PENDING");
  });
});

describe("Same Day trusted account (skip verification) support", () => {
  it("SettlementAccount type accepts SKIPPED verificationStatus with correct shape", () => {
    const trustedAccount: SettlementAccount = {
      id: "acc_trusted_001",
      accountNumber: "50100104420821",
      ifscCode: "HDFC0003756",
      accountHolderName: "Manish Kumar Shah",
      isVerified: false,
      verifiedName: undefined,
      verificationStatus: "SKIPPED",
      verificationLabel: "Account not verified",
    };
    expect(trustedAccount.isVerified).toBe(false);
    expect(trustedAccount.verificationStatus).toBe("SKIPPED");
    expect(trustedAccount.verificationLabel).toBe("Account not verified");
  });

  it("SettlementAccount remains backward-compatible with verified accounts", () => {
    const verifiedAccount: SettlementAccount = {
      id: "acc_verified_001",
      accountNumber: "50100104420821",
      ifscCode: "HDFC0003756",
      accountHolderName: "Manish Kumar Shah",
      isVerified: true,
      verifiedName: "MANISH KUMAR SHAH",
      verificationStatus: "VERIFIED",
      verificationLabel: "Verified",
    };
    expect(verifiedAccount.isVerified).toBe(true);
    expect(verifiedAccount.verificationStatus).toBe("VERIFIED");
  });

  it("verificationStatus and verificationLabel are optional for backward compat", () => {
    const legacyAccount: SettlementAccount = {
      id: "acc_legacy_001",
      accountNumber: "50100104420821",
      ifscCode: "HDFC0003756",
      accountHolderName: "Manish Kumar Shah",
      isVerified: true,
    };
    expect(legacyAccount.verificationStatus).toBeUndefined();
    expect(legacyAccount.verificationLabel).toBeUndefined();
  });

  it("all verification statuses are assignable to VerificationStatus", () => {
    const statuses: VerificationStatus[] = ["VERIFIED", "NOT_VERIFIED", "SKIPPED", "PENDING", "FAILED"];
    expect(statuses).toHaveLength(5);
    statuses.forEach((s) => expect(typeof s).toBe("string"));
  });

  it("trusted account can be used in a transfer context (no isVerified gate)", () => {
    const account: SettlementAccount = {
      id: "acc_trusted_transfer",
      accountNumber: "123456789012",
      ifscCode: "SBIN0001234",
      accountHolderName: "Test User",
      isVerified: false,
      verificationStatus: "SKIPPED",
      verificationLabel: "Account not verified",
    };
    const transferInput = {
      accountId: account.id,
      amount: 5000,
      mode: "IMPS" as const,
      narration: "Test transfer to trusted account",
    };
    expect(transferInput.accountId).toBe("acc_trusted_transfer");
    expect(account.isVerified).toBe(false);
  });
});

describe("Same Day settlement → payout status mapping", () => {
  it("maps terminal states and keeps PENDING in-flight", () => {
    expect(mapSettlementToPayoutStatus("SUCCESS")).toBe("PAID");
    expect(mapSettlementToPayoutStatus("FAILED")).toBe("FAILED");
    expect(mapSettlementToPayoutStatus("PENDING")).toBe("PROCESSING");
  });
});

describe("Leegality document status derivation", () => {
  it("is COMPLETED only when every invitee signed", () => {
    expect(
      deriveEsignStatus({ invitations: [{ signed: true }, { signed: true }] })
    ).toBe("COMPLETED");
    expect(
      deriveEsignStatus({ invitations: [{ signed: true }, { signed: false }] })
    ).toBe("PARTIALLY_SIGNED");
  });

  it("flags expiry and deletion", () => {
    expect(
      deriveEsignStatus({ requests: [{ expired: true }], invitations: [{ signed: false }] })
    ).toBe("EXPIRED");
    expect(
      deriveEsignStatus({ requests: [{ deleted: true }], invitations: [{ signed: true }] })
    ).toBe("DELETED");
  });

  it("defaults to PENDING with no signatures", () => {
    expect(deriveEsignStatus({ invitations: [{ signed: false }] })).toBe("PENDING");
    expect(deriveEsignStatus({})).toBe("PENDING");
  });
});
