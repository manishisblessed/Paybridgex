/**
 * End-to-end test for the document-resubmission flow.
 *
 * Drives the REAL applicant-side route handlers (onboard GET, documents POST,
 * resubmit POST) against the live DB, and replicates the admin
 * `request_resubmission` mutation (that route is auth-gated so it can't be
 * invoked head-less; its DB effect is reproduced here). Creates a throwaway
 * scenario and cleans everything up in a finally block.
 *
 * Run (repo root):  npx tsx scripts/testResubmitFlow.ts
 */
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

// ── Load .env before anything touches process.env (Prisma is lazy) ──
function loadEnv(file: string) {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${msg}`);
  } else {
    failed++;
    console.error(`  \u2717 ${msg}`);
  }
}

async function main() {
  const { prisma } = await import("@/lib/db");
  const { GET: onboardGet } = await import("@/app/api/onboard/[token]/route");
  const { POST: documentsPost } = await import(
    "@/app/api/onboard/[token]/documents/route"
  );
  const { POST: resubmitPost } = await import(
    "@/app/api/onboard/[token]/resubmit/route"
  );

  const stamp = Date.now();
  const tag = `resubmit-test-${stamp}`;
  const adminEmail = `admin.${stamp}@example.invalid`;
  const applicantEmail = `applicant.${stamp}@example.invalid`;
  const applicantPhone = `9${String(stamp).slice(-9)}`;

  let adminId = "";
  let userId = "";
  let inviteId = "";
  let freshToken = "";

  const cleanupOnly = process.argv.includes("--cleanup");

  try {
    if (cleanupOnly) {
      console.log("\n[cleanup-only] skipping test, sweeping test data");
      return;
    }
    console.log("\n[setup] creating throwaway admin + applicant + KYC + docs");

    const admin = await prisma.user.create({
      data: {
        name: `Test Admin ${stamp}`,
        email: adminEmail,
        phone: `8${String(stamp).slice(-9)}`,
        role: "ADMIN",
        status: "ACTIVE",
        passwordHash: "x",
      },
    });
    adminId = admin.id;

    const user = await prisma.user.create({
      data: {
        name: "Resubmit Test Applicant",
        email: applicantEmail,
        phone: applicantPhone,
        role: "RETAILER",
        status: "PENDING_KYC",
        passwordHash: "x",
      },
    });
    userId = user.id;

    await prisma.kyc.create({
      data: {
        userId: user.id,
        status: "PENDING_REVIEW",
        submittedAt: new Date(),
      },
    });

    const invite = await prisma.invite.create({
      data: {
        token: nanoid(24),
        phone: applicantPhone,
        email: applicantEmail,
        role: "RETAILER",
        invitedById: admin.id,
        userId: user.id,
        name: "Resubmit Test Applicant",
        status: "REGISTERED",
        phoneVerifiedAt: new Date(),
        emailVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      },
    });
    inviteId = invite.id;

    // Two uploaded documents (no publicId → no Cloudinary calls on cleanup).
    for (const t of ["PAN", "ELECTRICITY_BILL"]) {
      await prisma.verificationResult.create({
        data: {
          inviteId: invite.id,
          userId: user.id,
          type: `DOCUMENT_${t}`,
          orderid: `DOC_${stamp}_${t}_${nanoid(6)}`,
          status: "Uploaded",
          requestPayload: { url: "https://example.invalid/orig.jpg", format: "jpg", resourceType: "image" },
        },
      });
    }
    console.log(`  scenario ready (invite ${invite.id})`);

    // ── Replicate the admin `request_resubmission` DB effect ──
    console.log("\n[admin] flagging PAN + ELECTRICITY_BILL for re-upload");
    freshToken = nanoid(24);
    const rejectedRows = await prisma.verificationResult.findMany({
      where: { inviteId: invite.id, type: { in: ["DOCUMENT_PAN", "DOCUMENT_ELECTRICITY_BILL"] } },
    });
    await prisma.$transaction([
      ...rejectedRows.map((r) =>
        prisma.verificationResult.update({
          where: { id: r.id },
          data: {
            status: "Rejected",
            responsePayload: {
              rejectionReason:
                r.type === "DOCUMENT_PAN" ? "PAN photo is blurry" : "Wrong bill attached",
              rejectedAt: new Date().toISOString(),
              rejectedById: admin.id,
            },
          },
        })
      ),
      prisma.kyc.update({
        where: { userId: user.id },
        data: { status: "AWAITING_RESUBMISSION", reviewedById: admin.id, reviewedAt: new Date(), rejectedReason: "Re-upload requested: PAN Card, Household Electricity Bill" },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: { status: "RESUBMIT", token: freshToken, expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) },
      }),
    ]);
    assert(true, "admin mutation committed (enums AWAITING_RESUBMISSION / RESUBMIT accepted by DB)");

    const P = (token: string) => ({ params: Promise.resolve({ token }) });

    // ── a. onboard GET returns only the flagged docs, none done yet ──
    console.log("\n[applicant] GET /api/onboard/[token]");
    const g1 = await onboardGet(new Request(`http://localhost/api/onboard/${freshToken}`), P(freshToken));
    const g1b = await g1.json();
    assert(g1.status === 200, "GET returns 200");
    assert(g1b.invite?.status === "RESUBMIT", "invite.status is RESUBMIT");
    assert((g1b.resubmit?.documents?.length ?? 0) === 2, "returns 2 flagged documents");
    assert(g1b.resubmit?.documents?.every((d: any) => d.done === false), "no document is done yet");
    assert(g1b.resubmit?.allDone === false, "allDone is false initially");
    const reasons = (g1b.resubmit?.documents ?? []).map((d: any) => d.reason);
    assert(reasons.includes("PAN photo is blurry"), "PAN rejection reason surfaced");

    // ── b. scope guard: a NON-flagged type is rejected ──
    console.log("\n[applicant] scope guard: try uploading a non-flagged type (SIGNATURE)");
    const scope = await documentsPost(
      new Request(`http://localhost/api/onboard/${freshToken}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "SIGNATURE", publicId: "", url: "https://example.invalid/x.jpg", resourceType: "image", format: "jpg" }),
      }),
      P(freshToken)
    );
    assert(scope.status === 403, "non-flagged upload is blocked with 403");

    // ── c. re-upload the two flagged docs ──
    console.log("\n[applicant] re-uploading PAN + ELECTRICITY_BILL");
    for (const t of ["PAN", "ELECTRICITY_BILL"]) {
      const res = await documentsPost(
        new Request(`http://localhost/api/onboard/${freshToken}/documents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: t, publicId: "", url: "https://example.invalid/new.jpg", resourceType: "image", format: "jpg" }),
        }),
        P(freshToken)
      );
      assert(res.status === 200, `re-upload ${t} returns 200`);
    }

    // ── d. onboard GET now reports allDone ──
    console.log("\n[applicant] GET /api/onboard/[token] again");
    const g2 = await onboardGet(new Request(`http://localhost/api/onboard/${freshToken}`), P(freshToken));
    const g2b = await g2.json();
    assert(g2b.resubmit?.documents?.every((d: any) => d.done === true), "all documents now marked done");
    assert(g2b.resubmit?.allDone === true, "allDone is true after re-uploads");

    // ── e. submit the resubmission ──
    console.log("\n[applicant] POST /api/onboard/[token]/resubmit");
    const sub = await resubmitPost(
      new Request(`http://localhost/api/onboard/${freshToken}/resubmit`, { method: "POST" }),
      P(freshToken)
    );
    const subb = await sub.json();
    assert(sub.status === 200, "resubmit returns 200");
    assert(subb.status === "PENDING_REVIEW", "response status is PENDING_REVIEW");

    // ── f. verify final DB state ──
    console.log("\n[verify] final DB state");
    const finalKyc = await prisma.kyc.findUnique({ where: { userId } });
    const finalInvite = await prisma.invite.findUnique({ where: { id: inviteId } });
    const remainingRejected = await prisma.verificationResult.count({ where: { inviteId, status: "Rejected" } });
    const uploadedNow = await prisma.verificationResult.count({ where: { inviteId, status: "Uploaded" } });
    assert(finalKyc?.status === "PENDING_REVIEW", "KYC back to PENDING_REVIEW");
    assert(finalInvite?.status === "REGISTERED", "invite back to REGISTERED");
    assert(remainingRejected === 0, "no Rejected rows remain");
    assert(uploadedNow === 2, "two fresh Uploaded documents present");

    // ── g. dead-link guard: submitting again is rejected ──
    const dead = await resubmitPost(
      new Request(`http://localhost/api/onboard/${freshToken}/resubmit`, { method: "POST" }),
      P(freshToken)
    );
    assert(dead.status === 400, "re-submitting a closed link is blocked with 400");
  } finally {
    // ── cleanup: sweep every throwaway @example.invalid record (this run and
    // any orphans left by a prior failed run). Safe: example.invalid is a
    // reserved, non-routable test domain that can never match a real user. ──
    console.log("\n[cleanup] removing throwaway data");
    void adminId;
    void userId;
    void inviteId;
    void freshToken;
    try {
      const testInvites = await prisma.invite.findMany({
        where: { email: { endsWith: "@example.invalid" } },
        select: { id: true, userId: true },
      });
      const testUsers = await prisma.user.findMany({
        where: { email: { endsWith: "@example.invalid" } },
        select: { id: true },
      });
      const inviteIds = testInvites.map((i) => i.id);
      const userIds = [
        ...new Set([
          ...testUsers.map((u) => u.id),
          ...testInvites.map((i) => i.userId).filter((x): x is string => !!x),
        ]),
      ];

      if (inviteIds.length || userIds.length) {
        await prisma.verificationResult.deleteMany({
          where: { OR: [{ inviteId: { in: inviteIds } }, { userId: { in: userIds } }] },
        });
      }
      if (userIds.length) {
        await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.kyc.deleteMany({ where: { userId: { in: userIds } } });
      }
      // NB: AuditLog is intentionally append-only (DB trigger blocks DELETE),
      // so we leave the test audit entries in place — they're harmless log rows.
      if (inviteIds.length) {
        await prisma.invite.deleteMany({ where: { id: { in: inviteIds } } });
      }
      // Users referenced by an AuditLog can't be hard-deleted (the append-only
      // audit trigger blocks the FK SET NULL). Delete the rest; neutralise the
      // audit-locked stragglers so they're unmistakably inert test rows.
      let removedUsers = 0;
      let neutralised = 0;
      if (userIds.length) {
        const audited = new Set(
          (
            await prisma.auditLog.findMany({
              where: { userId: { in: userIds } },
              select: { userId: true },
            })
          )
            .map((a) => a.userId)
            .filter((x): x is string => !!x)
        );
        const deletable = userIds.filter((id) => !audited.has(id));
        const locked = userIds.filter((id) => audited.has(id));
        if (deletable.length) {
          const r = await prisma.user.deleteMany({ where: { id: { in: deletable } } });
          removedUsers = r.count;
        }
        for (const id of locked) {
          await prisma.user.update({
            where: { id },
            data: { status: "CLOSED", name: "[TEST-DATA] resubmit flow" },
          });
          neutralised++;
        }
      }
      console.log(
        `  cleanup done (removed ${removedUsers} users, ${inviteIds.length} invites; ${neutralised} audit-locked user(s) closed)`
      );
    } catch (e) {
      console.error("  cleanup error:", (e as Error).message);
    }
    await prisma.$disconnect();
  }

  console.log(`\n──────── ${passed} passed, ${failed} failed ────────`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
