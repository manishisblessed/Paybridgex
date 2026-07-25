import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireRole, AuthError } from "@/lib/auth-server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/security/audit";
import { dec, toNumber } from "@/lib/money";
import { debitWallet, LedgerError } from "@/lib/ledger";
import { runPosRentalBilling, rentalBillingSummary, istPeriodKey, computeRentalAmounts } from "@/lib/pos/rental";
import { getSetting, setSetting } from "@/lib/settings";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — rental console: plans, subscriptions, invoices, and revenue rollup. */
export async function GET(req: Request) {
  try {
    await requireRole("MASTER_ADMIN", "ADMIN", "SUPPORT", "FINANCE");

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = 25;

    const [cfg, waiverCfg, summary, plans, subs, subTotal, invoices] = await Promise.all([
      getSetting("pos.rental_billing"),
      getSetting("pos.rental_waiver"),
      rentalBillingSummary(),
      // Admin manages platform plans (ownerId = null). Network users' private
      // plans are managed by those users on their own dashboard.
      prisma.posRentalPlan.findMany({
        where: { ownerId: null },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { subscriptions: { where: { status: "ACTIVE" } } } } },
      }),
      prisma.posSubscription.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          plan: { select: { name: true, monthlyRent: true } },
          user: { select: { id: true, name: true, email: true } },
          machine: { select: { id: true, serial: true, tid: true, model: true } },
        },
      }),
      prisma.posSubscription.count(),
      prisma.posRentalInvoice.findMany({
        where: { periodKey: istPeriodKey() },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          subscription: {
            select: {
              user: { select: { name: true, email: true } },
              machine: { select: { serial: true, tid: true } },
              plan: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    return NextResponse.json({
      config: cfg,
      waiver: waiverCfg,
      summary,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        monthlyRent: toNumber(dec(p.monthlyRent)),
        setupFee: toNumber(dec(p.setupFee)),
        deposit: toNumber(dec(p.deposit)),
        includeGst: p.includeGst,
        active: p.active,
        activeSubscriptions: p._count.subscriptions,
      })),
      subscriptions: subs.map((s) => ({
        id: s.id,
        status: s.status,
        billingDay: s.billingDay,
        monthlyRent: s.monthlyRent ? toNumber(dec(s.monthlyRent)) : null,
        includeGst: s.includeGst,
        commission: toNumber(dec(s.commission)),
        startedAt: s.startedAt.toISOString(),
        cancelledAt: s.cancelledAt?.toISOString() ?? null,
        plan: { name: s.plan.name, monthlyRent: toNumber(dec(s.plan.monthlyRent)) },
        user: s.user,
        machine: s.machine,
        effectiveRent: toNumber(dec(s.monthlyRent ?? s.plan.monthlyRent)),
      })),
      subTotal,
      page,
      pageSize,
      invoices: invoices.map((i) => ({
        id: i.id,
        periodKey: i.periodKey,
        amount: toNumber(dec(i.amount)),
        gstAmount: toNumber(dec(i.gstAmount)),
        totalAmount: toNumber(dec(i.totalAmount)),
        commissionAmount: toNumber(dec(i.commissionAmount)),
        status: i.status,
        detail: i.detail,
        createdAt: i.createdAt.toISOString(),
        user: i.subscription.user,
        machine: i.subscription.machine,
        plan: i.subscription.plan.name,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    console.error("[admin/pos/rental] GET error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const ActionBody = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_plan"),
    name: z.string().min(2).max(80),
    description: z.string().max(300).optional(),
    monthlyRent: z.number().nonnegative(),
    setupFee: z.number().nonnegative().default(0),
    deposit: z.number().nonnegative().default(0),
    includeGst: z.boolean().default(false),
  }),
  z.object({ action: z.literal("toggle_plan"), planId: z.string().min(1), active: z.boolean() }),
  z.object({
    action: z.literal("update_plan"),
    planId: z.string().min(1),
    name: z.string().min(2).max(80),
    description: z.string().max(300).optional(),
    monthlyRent: z.number().nonnegative(),
    setupFee: z.number().nonnegative().default(0),
    deposit: z.number().nonnegative().default(0),
    includeGst: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("subscribe"),
    machineId: z.string().min(1),
    userId: z.string().min(1),
    planId: z.string().min(1),
    billingDay: z.number().int().min(1).max(28).default(1),
    chargeSetup: z.boolean().default(true),
    monthlyRent: z.number().nonnegative().optional(),
    commission: z.number().nonnegative().default(0),
    includeGst: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("subscribe_batch"),
    machineIds: z.array(z.string().min(1)).min(1).max(500),
    userId: z.string().min(1),
    planId: z.string().min(1),
    billingDay: z.number().int().min(1).max(28).default(1),
    chargeSetup: z.boolean().default(false),
    monthlyRent: z.number().nonnegative().optional(),
    commission: z.number().nonnegative().default(0),
    includeGst: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("cancel_subscription"),
    subscriptionId: z.string().min(1),
  }),
  z.object({ action: z.literal("run_billing") }),
  z.object({ action: z.literal("waive_invoice"), invoiceId: z.string().min(1), note: z.string().max(200).optional() }),
  z.object({ action: z.literal("toggle_billing"), enabled: z.boolean() }),
  z.object({ action: z.literal("set_billing_hour"), hour: z.number().int().min(0).max(23) }),
  z.object({ action: z.literal("toggle_waiver"), enabled: z.boolean() }),
  z.object({ action: z.literal("set_waiver_threshold"), amount: z.number().positive() }),
]);

/** POST — rental actions (plans, subscriptions, billing runs, waivers). */
export async function POST(req: Request) {
  let admin;
  try {
    admin = await requireRole("MASTER_ADMIN", "ADMIN");
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    throw e;
  }

  const parsed = ActionBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const audit = (action: string, meta: Record<string, unknown>) =>
    prisma.auditLog.create({
      data: {
        userId: admin.id,
        action,
        entity: "PosRental",
        meta: meta as Prisma.InputJsonValue,
        ip: clientIp(req),
      },
    });

  try {
    switch (body.action) {
      case "create_plan": {
        const exists = await prisma.posRentalPlan.findFirst({ where: { ownerId: null, name: body.name.trim() } });
        if (exists)
          return NextResponse.json({ error: `A plan named "${body.name}" already exists` }, { status: 409 });
        const plan = await prisma.posRentalPlan.create({
          data: {
            name: body.name.trim(),
            description: body.description?.trim(),
            monthlyRent: dec(body.monthlyRent),
            setupFee: dec(body.setupFee),
            deposit: dec(body.deposit),
            includeGst: body.includeGst,
          },
        });
        await audit("pos.rental_plan_created", { planId: plan.id, name: plan.name, includeGst: body.includeGst });
        return NextResponse.json({ ok: true, planId: plan.id }, { status: 201 });
      }

      case "toggle_plan": {
        await prisma.posRentalPlan.update({
          where: { id: body.planId },
          data: { active: body.active },
        });
        await audit("pos.rental_plan_toggled", { planId: body.planId, active: body.active });
        return NextResponse.json({ ok: true });
      }

      case "update_plan": {
        const existing = await prisma.posRentalPlan.findUnique({ where: { id: body.planId } });
        if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
        const duplicate = await prisma.posRentalPlan.findFirst({
          where: { ownerId: null, name: body.name, id: { not: body.planId } },
        });
        if (duplicate)
          return NextResponse.json({ error: `Another plan named "${body.name}" already exists` }, { status: 409 });
        await prisma.posRentalPlan.update({
          where: { id: body.planId },
          data: {
            name: body.name.trim(),
            description: body.description?.trim() || null,
            monthlyRent: dec(body.monthlyRent),
            setupFee: dec(body.setupFee),
            deposit: dec(body.deposit),
            includeGst: body.includeGst,
          },
        });
        await audit("pos.rental_plan_updated", {
          planId: body.planId,
          name: body.name,
          monthlyRent: body.monthlyRent,
          setupFee: body.setupFee,
          deposit: body.deposit,
          includeGst: body.includeGst,
        });
        return NextResponse.json({ ok: true });
      }

      case "subscribe": {
        const [machine, targetUser, plan] = await Promise.all([
          prisma.posMachine.findUnique({ where: { id: body.machineId }, select: { id: true, serial: true } }),
          prisma.user.findFirst({
            where: { id: body.userId, deletedAt: null },
            select: { id: true, name: true, role: true },
          }),
          prisma.posRentalPlan.findFirst({
            where: { id: body.planId, active: true },
          }),
        ]);
        if (!machine) return NextResponse.json({ error: "Machine not found" }, { status: 404 });
        if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
        // Rental subscriptions can be assigned to any network user (retailer →
        // super-distributor). Internal staff roles cannot hold rentals.
        const BILLABLE_ROLES = ["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"];
        if (!BILLABLE_ROLES.includes(targetUser.role))
          return NextResponse.json(
            { error: "Rental subscriptions can only be assigned to network users (retailer → super-distributor)" },
            { status: 400 }
          );
        if (!plan) return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });

        // Only block if this user already has an active subscription for this machine
        const existingUserSub = await prisma.posSubscription.findFirst({
          where: { machineId: machine.id, userId: targetUser.id, status: "ACTIVE" },
          select: { id: true },
        });
        if (existingUserSub)
          return NextResponse.json(
            { error: "This user already has an active rental subscription for this machine" },
            { status: 409 }
          );

        const effectiveRent = body.monthlyRent ?? toNumber(dec(plan.monthlyRent));

        const sub = await prisma.$transaction(async (tx) => {
          const created = await tx.posSubscription.create({
            data: {
              machineId: machine.id,
              userId: targetUser.id,
              planId: plan.id,
              billingDay: body.billingDay,
              monthlyRent: dec(effectiveRent),
              commission: dec(body.commission),
              includeGst: body.includeGst,
              createdById: admin.id,
            },
          });

          // Recalculate commission on downstream subscriptions created by this
          // SD. If the SD already assigned this machine downstream at ₹X/mo,
          // the stored commission was (X − 0) = X. Now that admin charges the
          // SD, the commission should be (X − effectiveRent).
          const downstreamSubs = await tx.posSubscription.findMany({
            where: { machineId: machine.id, createdById: targetUser.id, status: "ACTIVE" },
            select: { id: true, monthlyRent: true, plan: { select: { monthlyRent: true } } },
          });
          for (const ds of downstreamSubs) {
            const dsRent = toNumber(dec(ds.monthlyRent ?? ds.plan.monthlyRent));
            const newCommission = Math.max(0, Math.round((dsRent - effectiveRent) * 100) / 100);
            await tx.posSubscription.update({
              where: { id: ds.id },
              data: { commission: dec(newCommission) },
            });
          }

          return created;
        });

        const upfront = dec(plan.setupFee).add(dec(plan.deposit));
        if (body.chargeSetup && upfront.gt(0)) {
          try {
            await debitWallet({
              userId: targetUser.id,
              amount: upfront,
              reason: "RENTAL",
              refType: "PosSubscription",
              refId: sub.id,
              note: `POS setup+deposit · ${plan.name} · ${machine.serial ?? machine.id}`,
              idempotencyKey: `possetup:${sub.id}`,
            });
          } catch (e) {
            await prisma.posSubscription.delete({ where: { id: sub.id } });
            if (e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS")
              return NextResponse.json(
                { error: `User wallet cannot cover the ₹${toNumber(upfront)} setup + deposit` },
                { status: 400 }
              );
            throw e;
          }
        }

        await audit("pos.subscription_created", {
          subscriptionId: sub.id,
          machineId: machine.id,
          userId: targetUser.id,
          planId: plan.id,
          monthlyRent: effectiveRent,
          commission: body.commission,
          includeGst: body.includeGst,
          upfrontCharged: body.chargeSetup ? toNumber(upfront) : 0,
        });
        return NextResponse.json({ ok: true, subscriptionId: sub.id }, { status: 201 });
      }

      case "subscribe_batch": {
        const BILLABLE_ROLES = ["RETAILER", "DISTRIBUTOR", "MASTER_DISTRIBUTOR", "SUPER_DISTRIBUTOR"];
        const [targetUser, plan] = await Promise.all([
          prisma.user.findFirst({
            where: { id: body.userId, deletedAt: null },
            select: { id: true, name: true, role: true },
          }),
          prisma.posRentalPlan.findFirst({ where: { id: body.planId, active: true } }),
        ]);
        if (!targetUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
        if (!BILLABLE_ROLES.includes(targetUser.role))
          return NextResponse.json(
            { error: "Rental subscriptions can only be assigned to network users (retailer → super-distributor)" },
            { status: 400 }
          );
        if (!plan) return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });

        const effectiveRent = body.monthlyRent ?? toNumber(dec(plan.monthlyRent));
        const upfront = dec(plan.setupFee).add(dec(plan.deposit));
        const machineIds = Array.from(new Set(body.machineIds));

        // Bulk-load machines and this user's existing active subs up-front so the
        // loop does no redundant per-machine lookups.
        const [machines, existingSubs] = await Promise.all([
          prisma.posMachine.findMany({
            where: { id: { in: machineIds } },
            select: { id: true, serial: true },
          }),
          prisma.posSubscription.findMany({
            where: { machineId: { in: machineIds }, userId: targetUser.id, status: "ACTIVE" },
            select: { machineId: true },
          }),
        ]);
        const machineById = new Map(machines.map((m) => [m.id, m]));
        const alreadySubbed = new Set(existingSubs.map((s) => s.machineId));

        let created = 0;
        const createdIds: string[] = [];
        const errors: Array<{ machineId: string; error: string }> = [];

        for (const machineId of machineIds) {
          const machine = machineById.get(machineId);
          if (!machine) {
            errors.push({ machineId, error: "machine not found" });
            continue;
          }
          if (alreadySubbed.has(machineId)) {
            errors.push({ machineId, error: "already has an active subscription" });
            continue;
          }
          try {
            const sub = await prisma.$transaction(async (tx) => {
              const c = await tx.posSubscription.create({
                data: {
                  machineId,
                  userId: targetUser.id,
                  planId: plan.id,
                  billingDay: body.billingDay,
                  monthlyRent: dec(effectiveRent),
                  commission: dec(body.commission),
                  includeGst: body.includeGst,
                  createdById: admin.id,
                },
              });
              const downstreamSubs = await tx.posSubscription.findMany({
                where: { machineId, createdById: targetUser.id, status: "ACTIVE" },
                select: { id: true, monthlyRent: true, plan: { select: { monthlyRent: true } } },
              });
              for (const ds of downstreamSubs) {
                const dsRent = toNumber(dec(ds.monthlyRent ?? ds.plan.monthlyRent));
                const newCommission = Math.max(0, Math.round((dsRent - effectiveRent) * 100) / 100);
                await tx.posSubscription.update({
                  where: { id: ds.id },
                  data: { commission: dec(newCommission) },
                });
              }
              return c;
            });

            if (body.chargeSetup && upfront.gt(0)) {
              try {
                await debitWallet({
                  userId: targetUser.id,
                  amount: upfront,
                  reason: "RENTAL",
                  refType: "PosSubscription",
                  refId: sub.id,
                  note: `POS setup+deposit · ${plan.name} · ${machine.serial ?? machine.id}`,
                  idempotencyKey: `possetup:${sub.id}`,
                });
              } catch (e) {
                await prisma.posSubscription.delete({ where: { id: sub.id } });
                errors.push({
                  machineId,
                  error:
                    e instanceof LedgerError && e.code === "INSUFFICIENT_FUNDS"
                      ? `wallet cannot cover ₹${toNumber(upfront)} setup + deposit`
                      : "setup charge failed",
                });
                continue;
              }
            }

            created++;
            createdIds.push(sub.id);
          } catch (e) {
            console.error("[admin/pos/rental] batch subscribe error:", e);
            errors.push({ machineId, error: "could not create subscription" });
          }
        }

        await audit("pos.subscription_batch_created", {
          userId: targetUser.id,
          planId: plan.id,
          requested: machineIds.length,
          created,
          failed: errors.length,
          monthlyRent: effectiveRent,
          commission: body.commission,
          includeGst: body.includeGst,
        });
        return NextResponse.json({ ok: true, created, failed: errors.length, errors, createdIds }, { status: 201 });
      }

      case "cancel_subscription": {
        const sub = await prisma.posSubscription.findUnique({ where: { id: body.subscriptionId } });
        if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
        if (sub.status !== "ACTIVE")
          return NextResponse.json({ error: `Subscription is already ${sub.status}` }, { status: 409 });

        await prisma.$transaction(async (tx) => {
          await tx.posSubscription.update({
            where: { id: sub.id },
            data: { status: "CANCELLED", cancelledAt: new Date() },
          });

          // If this was an upstream (admin→SD) subscription, recalculate
          // downstream commissions — the upstream cost is now 0.
          const downstreamSubs = await tx.posSubscription.findMany({
            where: { machineId: sub.machineId, createdById: sub.userId, status: "ACTIVE" },
            select: { id: true, monthlyRent: true, plan: { select: { monthlyRent: true } } },
          });
          for (const ds of downstreamSubs) {
            const dsRent = toNumber(dec(ds.monthlyRent ?? ds.plan.monthlyRent));
            await tx.posSubscription.update({
              where: { id: ds.id },
              data: { commission: dec(dsRent) },
            });
          }
        });

        await audit("pos.subscription_cancelled", { subscriptionId: sub.id });
        return NextResponse.json({ ok: true });
      }

      case "run_billing": {
        const r = await runPosRentalBilling();
        await audit("pos.rental_billing_manual", r as unknown as Record<string, unknown>);
        return NextResponse.json({ ok: true, result: r });
      }

      case "waive_invoice": {
        const inv = await prisma.posRentalInvoice.findUnique({ where: { id: body.invoiceId } });
        if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
        if (inv.status !== "FAILED")
          return NextResponse.json({ error: `Only FAILED invoices can be waived (this one is ${inv.status})` }, { status: 409 });
        await prisma.posRentalInvoice.update({
          where: { id: inv.id },
          data: { status: "WAIVED", detail: body.note?.trim() || "waived by admin" },
        });
        await audit("pos.invoice_waived", { invoiceId: inv.id, note: body.note ?? null });
        return NextResponse.json({ ok: true });
      }

      case "toggle_billing": {
        const cfg = await getSetting("pos.rental_billing");
        await setSetting("pos.rental_billing", { ...cfg, enabled: body.enabled }, admin.id);
        await audit("pos.rental_billing_toggled", { enabled: body.enabled });
        return NextResponse.json({ ok: true });
      }

      case "set_billing_hour": {
        const cfg = await getSetting("pos.rental_billing");
        await setSetting("pos.rental_billing", { ...cfg, hour: body.hour }, admin.id);
        await audit("pos.rental_billing_hour_changed", { hour: body.hour });
        return NextResponse.json({ ok: true });
      }

      case "toggle_waiver": {
        const cfg = await getSetting("pos.rental_waiver");
        await setSetting("pos.rental_waiver", { ...cfg, enabled: body.enabled }, admin.id);
        await audit("pos.rental_waiver_toggled", { enabled: body.enabled });
        return NextResponse.json({ ok: true });
      }

      case "set_waiver_threshold": {
        const cfg = await getSetting("pos.rental_waiver");
        await setSetting("pos.rental_waiver", { ...cfg, thresholdPerMachine: body.amount }, admin.id);
        await audit("pos.rental_waiver_threshold_changed", { amount: body.amount });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    console.error("[admin/pos/rental] POST error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
