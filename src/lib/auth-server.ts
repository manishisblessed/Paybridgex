import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getServerSession as _getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { headers } from "next/headers";
import { prisma } from "./db";
import {
  assertNotLocked,
  recordFailedLogin,
  recordSuccessfulLogin,
  AccountLockedError,
  normalizeIdentifier,
} from "./security/lockout";
import { bumpTokenVersion } from "./security/session";
import {
  getCachedSessionValidation,
  setCachedSessionValidation,
} from "./security/sessionValidationCache";
import { isLoginAllowed } from "./security/accountGate";

export type SessionUser = {
  id: string;
  userCode: string | null;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  walletBalance: number;
  allowedTabs: string[];
  enabledServices: string[];
  twoFactorEnabled: boolean;
  /** Master-admin waived the mandatory-2FA gate for this account. */
  twoFactorExempt: boolean;
};

declare module "next-auth" {
  interface Session {
    user: SessionUser;
  }
  interface User extends SessionUser {}
}

declare module "next-auth/jwt" {
  interface JWT extends SessionUser {
    /** Version this token was minted with; checked against User.tokenVersion. */
    tokenVersion: number;
    enabledServices: string[];
  }
}

export const authOptions: NextAuthOptions = {
  // Explicit secret so a misconfigured runtime fails loudly at startup rather
  // than 500-ing every /api/auth/* request with a cryptic "server configuration"
  // error. NextAuth requires this in production.
  secret: process.env.NEXTAUTH_SECRET,
  // Opt-in only (set NEXTAUTH_DEBUG=true) — always-on dev debug spams the
  // console with [next-auth][warn][DEBUG_ENABLED] on every compile.
  debug: process.env.NEXTAUTH_DEBUG === "true",
  // Short JWT lifetime for a finance portal; combined with the per-request
  // tokenVersion check this bounds how long any leaked/replayed cookie is usable.
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      id: "token-login",
      name: "token-login",
      credentials: {
        grant: { label: "Session Grant", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.grant) return null;

        // Verify the HMAC-signed session grant
        const parts = credentials.grant.split(".");
        if (parts.length !== 2) return null;

        const [payloadB64, sig] = parts;
        const secret = process.env.NEXTAUTH_SECRET ?? "";
        const payload = Buffer.from(payloadB64, "base64").toString();
        const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");

        // Constant-time comparison
        if (sig.length !== expectedSig.length) return null;
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;

        const [userId, expStr] = payload.split(":");
        const exp = parseInt(expStr, 10);
        if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return null;

        const user = await prisma.user.findUnique({
          where: { id: userId },
        });
        if (!user || !isLoginAllowed(user.status)) return null;

        return {
          id: user.id,
          userCode: (user as any).userCode ?? null,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          walletBalance: Number(user.walletBalance),
          allowedTabs: (user as any).allowedTabs ?? [],
          enabledServices: (user as any).enabledServices ?? [],
          twoFactorEnabled: user.twoFactorEnabled,
          twoFactorExempt: (user as any).twoFactorExempt ?? false,
        };
      },
    }),
    CredentialsProvider({
      id: "credentials",
      name: "credentials",
      credentials: {
        identifier: { label: "Email or Phone", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) return null;

        const identifier = normalizeIdentifier(credentials.identifier);

        // Brute-force lockout (shared with /api/auth/login). A locked
        // identifier is refused here too; surface a clear error to NextAuth.
        try {
          await assertNotLocked(identifier);
        } catch (e) {
          if (e instanceof AccountLockedError) throw new Error("ACCOUNT_LOCKED");
          throw e;
        }

        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { email: identifier },
              { phone: identifier },
            ],
            deletedAt: null,
          },
        });

        const valid = user ? await bcrypt.compare(credentials.password, user.passwordHash) : false;
        if (!user || !valid) {
          await recordFailedLogin(identifier);
          return null;
        }

        if (!isLoginAllowed(user.status)) return null;

        // If 2FA is enabled, block NextAuth session creation.
        // The frontend must use /api/auth/login → /api/auth/2fa/verify flow instead.
        if (user.twoFactorEnabled) return null;

        // 2FA-exempt accounts with PIN login enabled must authenticate through
        // the /api/auth/login → /api/auth/pin-login/verify flow (TPIN as the
        // second factor), never via a bare password on this provider.
        if ((user as any).twoFactorExempt && (user as any).pinLoginEnabled) return null;

        await recordSuccessfulLogin(identifier);

        return {
          id: user.id,
          userCode: (user as any).userCode ?? null,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          walletBalance: Number(user.walletBalance),
          allowedTabs: (user as any).allowedTabs ?? [],
          enabledServices: (user as any).enabledServices ?? [],
          twoFactorEnabled: user.twoFactorEnabled,
          twoFactorExempt: (user as any).twoFactorExempt ?? false,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // ── Fresh sign-in: seed the token (incl. the current tokenVersion) and
      //    trust it for this pass — no validation needed, it was just minted.
      if (user) {
        token.id = user.id;
        token.userCode = (user as any).userCode ?? null;
        token.name = user.name;
        token.email = user.email;
        token.phone = user.phone;
        token.role = user.role;
        token.status = user.status;
        token.walletBalance = user.walletBalance;
        token.allowedTabs = (user as any).allowedTabs ?? [];
        token.enabledServices = (user as any).enabledServices ?? [];
        token.twoFactorEnabled = (user as any).twoFactorEnabled ?? false;
        token.twoFactorExempt = (user as any).twoFactorExempt ?? false;
        try {
          const seed = await prisma.user.findUnique({
            where: { id: user.id },
            select: { tokenVersion: true },
          });
          token.tokenVersion = seed?.tokenVersion ?? 0;
        } catch (err) {
          console.error("[auth] jwt callback: DB error seeding tokenVersion", err);
          token.tokenVersion = 0;
        }
        return token;
      }

      // ── Every subsequent request: re-validate against the DB so privilege
      //    changes and forced sign-outs take effect immediately, and reject any
      //    token whose version != the user's current tokenVersion (replay /
      //    stolen-cookie defense).
      //
      //    If the DB is temporarily unreachable, return the stale token so the
      //    session endpoint doesn't 500 on every page load — the next successful
      //    check will catch up.
      if (token.id) {
        try {
          const userId = token.id as string;
          // Short-TTL cache: dashboard pages fire many API calls in parallel
          // and each one would otherwise pay a full DB round trip here before
          // doing any real work. Same-process privilege changes invalidate the
          // cache immediately; cross-instance changes are bounded by the TTL.
          let fresh = getCachedSessionValidation(userId);
          if (fresh === undefined) {
            fresh = await prisma.user.findUnique({
              where: { id: userId },
              select: {
                name: true,
                userCode: true,
                tokenVersion: true,
                twoFactorEnabled: true,
                twoFactorExempt: true,
                walletBalance: true,
                status: true,
                role: true,
                enabledServices: true,
              },
            });
            setCachedSessionValidation(userId, fresh);
          }
          if (
            !fresh ||
            !isLoginAllowed(fresh.status) ||
            (token.tokenVersion ?? -1) !== fresh.tokenVersion
          ) {
            return {} as typeof token;
          }
          token.name = fresh.name;
          token.userCode = (fresh as any).userCode ?? null;
          token.tokenVersion = fresh.tokenVersion;
          token.twoFactorEnabled = fresh.twoFactorEnabled;
          token.twoFactorExempt = fresh.twoFactorExempt;
          token.walletBalance = Number(fresh.walletBalance);
          token.status = fresh.status;
          token.role = fresh.role;
          token.enabledServices = fresh.enabledServices;
        } catch (err) {
          console.error("[auth] jwt callback: DB error refreshing token, using stale data", err);
        }
      }

      return token;
    },
    async session({ session, token }) {
      // A token invalidated in the jwt callback has no id — fail closed by
      // returning a session without a user so requireAuth() rejects it.
      if (!token?.id) {
        return { ...session, user: undefined as unknown as SessionUser };
      }
      session.user = {
        id: token.id as string,
        userCode: (token.userCode as string) ?? null,
        name: token.name as string,
        email: token.email as string,
        phone: token.phone as string,
        role: token.role as string,
        status: token.status as string,
        walletBalance: token.walletBalance as number,
        allowedTabs: (token.allowedTabs as string[]) ?? [],
        enabledServices: (token.enabledServices as string[]) ?? [],
        twoFactorEnabled: (token.twoFactorEnabled as boolean) ?? false,
        twoFactorExempt: (token.twoFactorExempt as boolean) ?? false,
      };
      return session;
    },
  },
  events: {
    // Logout invalidates every outstanding token for this user (server-side),
    // so pressing Back / replaying a cached cookie cannot resurrect the session.
    async signOut({ token }) {
      if (token?.id) {
        await bumpTokenVersion(token.id as string, { swallow: true });
      }
    },
  },
};

export async function getServerAuth() {
  return _getServerSession(authOptions);
}

// ---------------------------------------------------------------------------
// Mobile JWT helpers (HS256 — used by /api/auth/login for mobile clients)
// ---------------------------------------------------------------------------

function jwtSecret() {
  const s = process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("[auth] JWT_SECRET or NEXTAUTH_SECRET must be set");
  return s;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Short-lived HMAC-signed grant for the token-login NextAuth provider.
 * Used after 2FA verification and for needsSetup (no-2FA) logins so
 * the frontend can establish a session without a second password check.
 */
export function createSessionGrant(userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  const exp = Math.floor(Date.now() / 1000) + 30;
  const payload = `${userId}:${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64")}.${sig}`;
}

export function createMobileToken(user: SessionUser, expiresInSec = 30 * 24 * 60 * 60): string {
  const header = base64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64url(Buffer.from(JSON.stringify({
    sub: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    allowedTabs: user.allowedTabs,
    enabledServices: user.enabledServices,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSec,
  })));
  const signature = base64url(
    crypto.createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

export function verifyMobileToken(token: string): SessionUser | null {
  try {
    const [header, payload, signature] = token.split(".");
    if (!header || !payload || !signature) return null;

    const expected = base64url(
      crypto.createHmac("sha256", jwtSecret()).update(`${header}.${payload}`).digest()
    );
    if (signature !== expected) return null;

    const pad = (s: string) => s + "=".repeat((4 - (s.length % 4)) % 4);
    const data = JSON.parse(Buffer.from(pad(payload.replace(/-/g, "+").replace(/_/g, "/")), "base64").toString());

    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      id: data.sub,
      userCode: data.userCode ?? null,
      name: data.name,
      email: data.email,
      phone: data.phone,
      role: data.role,
      status: data.status,
      walletBalance: 0,
      allowedTabs: data.allowedTabs ?? [],
      enabledServices: data.enabledServices ?? [],
      twoFactorEnabled: data.twoFactorEnabled ?? false,
      twoFactorExempt: data.twoFactorExempt ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * Get authenticated user or throw. Checks NextAuth session first,
 * then falls back to Bearer token (for mobile/API clients).
 */
export async function requireAuth(): Promise<SessionUser> {
  // 1. Try NextAuth session (web)
  const session = await getServerAuth();
  if (session?.user) {
    if (!isLoginAllowed(session.user.status)) {
      throw new AuthError("Account is not active", 403);
    }
    return session.user;
  }

  // 2. Try Bearer token (mobile / API)
  const h = headers();
  const auth = h.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const user = verifyMobileToken(auth.slice(7));
    if (user) {
      // Refresh wallet balance from DB for accuracy
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { walletBalance: true, status: true },
      });
      if (dbUser) {
        user.walletBalance = Number(dbUser.walletBalance);
        user.status = dbUser.status;
      }
      if (!isLoginAllowed(user.status)) {
        throw new AuthError("Account is not active", 403);
      }
      return user;
    }
  }

  throw new AuthError("Unauthorized", 401);
}

/**
 * Get authenticated user with specific role(s) or throw.
 */
export async function requireRole(...roles: string[]) {
  const user = await requireAuth();
  if (!roles.includes(user.role)) {
    throw new AuthError("Forbidden", 403);
  }
  return user;
}

export class AuthError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "AuthError";
  }
}
