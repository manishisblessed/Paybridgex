import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { getPartner } from "@/lib/partners";
import {
  canOnboard,
  defaultChildRole,
  ONBOARD_CAPABLE_ROLES,
  uplineInclude,
  flattenUpline,
  type UplineNode,
} from "@/lib/hierarchy";
import { env } from "@/lib/env";
import { renderInviteEmail } from "@/lib/email/templates";
import { getAdminInviteScope } from "@/lib/security/ownership";
import { computeInviteExpiry } from "@/lib/onboarding/inviteExpiry";

/**
 * A PENDING invite whose link has passed `expiresAt` is effectively EXPIRED —
 * the onboarding endpoints already reject it, but we never persist the flip so
 * an admin can still reshare it. This derives the query filter for a requested
 * tab so "Pending" only lists live links and "Expired" also catches
 * PENDING-but-past-expiry ones (kept in sync with the badge derived below).
 */
function statusFilterWhere(status: string | null, now: Date): Record<string, unknown> {
  if (!status) return {};
  if (status === "PENDING") {
    return { status: "PENDING", expiresAt: { gte: now } };
  }
  if (status === "EXPIRED") {
    return {
      OR: [
        { status: "EXPIRED" },
        { status: "PENDING", expiresAt: { lt: now } },
      ],
    };
  }
  return { status };
}

/** Effective status shown to admins: PENDING past its expiry reads as EXPIRED. */
function effectiveInviteStatus(
  status: string,
  expiresAt: Date,
  now: Date
): string {
  return status === "PENDING" && expiresAt < now ? "EXPIRED" : status;
}

const CreateBody = z.object({
  phone: z.string().min(10).max(15),
  email: z.string().email(),
  name: z.string().min(2).optional(),
  role: z.enum(["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"]).optional(),
  parentId: z.string().cuid().optional(),
});

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  if (!ONBOARD_CAPABLE_ROLES.includes(user.role as any)) {
    return NextResponse.json(
      { error: "You do not have permission to create invites" },
      { status: 403 }
    );
  }

  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { phone, email, name } = parsed.data;
  const role = parsed.data.role ?? defaultChildRole(user.role);

  if (!canOnboard(user.role, role)) {
    const allowed = defaultChildRole(user.role).replace(/_/g, " ");
    return NextResponse.json(
      { error: `Your role can only invite a ${allowed}` },
      { status: 403 }
    );
  }

  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { phone }] },
  });
  if (existingUser) {
    return NextResponse.json(
      { error: "A user with this email or phone already exists" },
      { status: 409 }
    );
  }

  const existingInvite = await prisma.invite.findFirst({
    where: {
      OR: [{ email: email.toLowerCase() }, { phone }],
      status: { in: ["PENDING", "REGISTERED"] },
    },
  });
  if (existingInvite) {
    return NextResponse.json(
      { error: "An active invite already exists for this email or phone" },
      { status: 409 }
    );
  }

  // Determine parentId:
  // - Network roles creating their child → they are the parent
  // - Master Admin providing an explicit parentId → use it (validated below)
  // - Admin/Staff creating SD (top-level) → no parent needed
  let parentId: string | undefined;
  if (["MASTER_ADMIN", "ADMIN", "SUPPORT"].includes(user.role)) {
    if (parsed.data.parentId && user.role === "MASTER_ADMIN" && role !== "SUPER_DISTRIBUTOR") {
      const parentUser = await prisma.user.findFirst({
        where: { id: parsed.data.parentId, status: "ACTIVE" },
        select: { id: true, role: true },
      });
      if (!parentUser) {
        return NextResponse.json(
          { error: "Selected parent user not found or inactive" },
          { status: 400 }
        );
      }
      parentId = parentUser.id;
    } else {
      parentId = undefined;
    }
  } else {
    parentId = user.id;
  }

  const invite = await prisma.invite.create({
    data: {
      phone,
      email: email.toLowerCase(),
      name,
      role,
      parentId,
      invitedById: user.id,
      expiresAt: await computeInviteExpiry(),
    },
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  const onboardingLink = `${appUrl}/onboard?token=${invite.token}`;

  let emailSent = false;
  let emailError: string | undefined;
  try {
    const emailProvider = getPartner("email");
    const { subject, html } = renderInviteEmail({
      name,
      role,
      onboardingLink,
      expiresAt: invite.expiresAt,
    });
    const result = await emailProvider.send({
      from: process.env.EMAIL_FROM_INFO || process.env.EMAIL_FROM,
      to: email,
      subject,
      html,
    });
    emailSent = result.ok;
    if (!result.ok) emailError = `${result.code}: ${result.message}`;
  } catch (e) {
    // Email failure shouldn't block invite creation, but we surface the reason.
    emailError = (e as Error).message;
  }

  try {
    const smsProvider = getPartner("sms");
    await smsProvider.sendTransactional({
      phone,
      templateId: "onboard_invite",
      variables: { link: onboardingLink, role: role.replace(/_/g, " ") },
    });
  } catch {
    // SMS failure shouldn't block invite creation
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "invite.created",
      entity: "Invite",
      entityId: invite.id,
      meta: { phone, email, role, parentId, emailSent, emailError },
      ip: clientIp(req),
    },
  });

  return NextResponse.json(
    {
      ok: true,
      invite: { id: invite.id, token: invite.token, onboardingLink },
      emailSent,
      ...(emailError ? { emailError } : {}),
    },
    { status: 201 }
  );
}

export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuth();
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  // Master admin sees every invite. A plain admin can only see invites when a
  // master admin has granted the "invites" tab, and even then their view is
  // scoped to their own hierarchy (the SDs they onboarded + downline).
  const isMasterAdmin = user.role === "MASTER_ADMIN";
  const isPermittedAdmin =
    user.role === "ADMIN" && (user.allowedTabs ?? []).includes("invites");
  if (!isMasterAdmin && !isPermittedAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "20"));

  const now = new Date();
  const statusWhere = statusFilterWhere(status, now);
  let where: any = statusWhere;
  if (!isMasterAdmin) {
    const { actorIds, treeIds } = await getAdminInviteScope(user);
    // Visible if the admin (or someone in their tree) created the invite, or
    // the invite targets a user in their tree (registered userId / pending
    // parentId). actorIds always contains the admin's own id.
    const scopeOr: any[] = [{ invitedById: { in: actorIds } }];
    if (treeIds.length) {
      scopeOr.push({ userId: { in: treeIds } }, { parentId: { in: treeIds } });
    }
    // AND the (possibly OR-based) status filter with the scope OR so neither
    // clause clobbers the other.
    where = { AND: [statusWhere, { OR: scopeOr }] };
  }

  const [invites, total] = await Promise.all([
    prisma.invite.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.invite.count({ where }),
  ]);

  // Resolve each invite's upline chain (DT → MD → SD). Once an invitee has
  // registered we walk the real User (invite.userId); otherwise we fall back
  // to the immediate parent chosen at invite time (invite.parentId).
  const anchorIds = [
    ...new Set(
      invites
        .flatMap((i) => [i.userId, i.parentId, i.invitedById])
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const anchors = anchorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: anchorIds } },
        select: {
          id: true,
          name: true,
          role: true,
          userCode: true,
          shopName: true,
          ...uplineInclude,
        },
      })
    : [];
  const anchorMap = new Map(anchors.map((a) => [a.id, a]));

  const invitesOut = invites.map((inv) => {
    const anchorId = inv.userId ?? inv.parentId;
    const anchor = anchorId ? anchorMap.get(anchorId) : null;
    let upline: UplineNode[] = [];
    if (anchor) {
      if (inv.userId) {
        // Anchor is the registered invitee — its ancestors are the upline.
        upline = flattenUpline(anchor);
        // Fallback: if the registered user has no parent chain, try the
        // invite's original parentId (covers cases where parentId wasn't
        // propagated to the User record).
        if (upline.length === 0 && inv.parentId && inv.parentId !== inv.userId) {
          const fallback = anchorMap.get(inv.parentId);
          if (fallback) {
            upline = [
              {
                id: fallback.id,
                name: fallback.name,
                role: fallback.role as UplineNode["role"],
                userCode: fallback.userCode ?? null,
                shopName: fallback.shopName ?? null,
              },
              ...flattenUpline(fallback),
            ];
          }
        }
      } else {
        // Anchor is the immediate parent — include it plus its ancestors.
        upline = [
          {
            id: anchor.id,
            name: anchor.name,
            role: anchor.role as UplineNode["role"],
            userCode: anchor.userCode ?? null,
            shopName: anchor.shopName ?? null,
          },
          ...flattenUpline(anchor),
        ];
      }
    }

    // Include the registered user's userCode if available.
    let registeredUserCode: string | null = null;
    if (inv.userId) {
      const regUser = anchorMap.get(inv.userId);
      if (regUser) registeredUserCode = regUser.userCode ?? null;
    }

    // Who shared/created this invite (any user in the network or staff).
    const inviter = inv.invitedById ? anchorMap.get(inv.invitedById) : null;

    return {
      ...inv,
      status: effectiveInviteStatus(inv.status, inv.expiresAt, now),
      userCode: registeredUserCode,
      invitedBy: inviter
        ? {
            id: inviter.id,
            name: inviter.name,
            role: inviter.role,
            userCode: inviter.userCode ?? null,
          }
        : null,
      onboardingLink: `${env.NEXT_PUBLIC_APP_URL}/onboard?token=${inv.token}`,
      upline: upline.map((n) => ({
        role: n.role,
        name: n.name,
        userCode: n.userCode,
      })),
    };
  });

  return NextResponse.json({ invites: invitesOut, total, page, limit });
}
