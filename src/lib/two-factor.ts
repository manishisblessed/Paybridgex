import { TOTP, Secret } from "otpauth";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { encrypt, decrypt } from "./crypto";

const APP_NAME = "Paybridgex";
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_WINDOW = 1; // allow 1 period drift (±30s)
const BACKUP_CODE_COUNT = 10;
const TEMP_TOKEN_TTL_SEC = 180; // 3 minutes

// ─── TOTP Secret Management ────────────────────────────────────────────────────

export function generateTotpSecret(): string {
  const secret = new Secret({ size: 20 });
  return secret.base32;
}

export function encryptSecret(base32: string): string {
  return encrypt(base32);
}

export function decryptSecret(encrypted: string): string {
  return decrypt(encrypted);
}

export function getTotpUri(base32Secret: string, userEmail: string): string {
  const totp = new TOTP({
    issuer: APP_NAME,
    label: userEmail,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(base32Secret),
  });
  return totp.toString();
}

// ─── TOTP Verification ─────────────────────────────────────────────────────────

export function verifyTotpCode(base32Secret: string, code: string): boolean {
  if (!code || code.length !== TOTP_DIGITS) return false;

  const totp = new TOTP({
    issuer: APP_NAME,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(base32Secret),
  });

  const delta = totp.validate({ token: code, window: TOTP_WINDOW });
  return delta !== null;
}

// ─── Backup Codes ──────────────────────────────────────────────────────────────

export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw = crypto.randomBytes(4).toString("hex"); // 8 char hex
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(c.replace("-", ""), 10)));
}

export async function verifyBackupCode(
  plainCode: string,
  hashedCodes: string[]
): Promise<{ valid: boolean; index: number }> {
  const normalized = plainCode.replace("-", "").toLowerCase();
  for (let i = 0; i < hashedCodes.length; i++) {
    if (!hashedCodes[i]) continue; // already used
    const match = await bcrypt.compare(normalized, hashedCodes[i]);
    if (match) return { valid: true, index: i };
  }
  return { valid: false, index: -1 };
}

// ─── Temp Token (2FA Challenge) ────────────────────────────────────────────────

function tempTokenSecret(): string {
  const s = process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("[2FA] JWT_SECRET or NEXTAUTH_SECRET must be set");
  return s;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecode(str: string): Buffer {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export interface TempTokenPayload {
  sub: string; // userId
  purpose: "2fa_challenge";
  attempts: number;
  iat: number;
  exp: number;
}

export function createTempToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        sub: userId,
        purpose: "2fa_challenge",
        attempts: 0,
        iat: now,
        exp: now + TEMP_TOKEN_TTL_SEC,
      })
    )
  );
  const signature = base64url(
    crypto.createHmac("sha256", tempTokenSecret()).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

export function verifyTempToken(token: string): TempTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;

    const expected = base64url(
      crypto.createHmac("sha256", tempTokenSecret()).update(`${header}.${payload}`).digest()
    );

    // Constant-time comparison
    if (signature.length !== expected.length) return null;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (!crypto.timingSafeEqual(a, b)) return null;

    const data: TempTokenPayload = JSON.parse(base64urlDecode(payload).toString());

    if (data.purpose !== "2fa_challenge") return null;
    if (data.exp < Math.floor(Date.now() / 1000)) return null;

    return data;
  } catch {
    return null;
  }
}

// Max 3 attempts per temp token
export const MAX_2FA_ATTEMPTS = 3;
