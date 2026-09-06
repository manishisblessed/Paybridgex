import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const num = (d) => (d == null ? null : Number(d));

const norm = (provider) => {
  if (!provider) return null;
  const s = String(provider).trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith("SAMEDAY")) return "SAMEDAY";
  if (s.startsWith("BULKPE")) return "BULKPE";
  if (s.startsWith("RAZORPAY")) return "RAZORPAY";
  if (s.startsWith("PAYSPRINT")) return "PAYSPRINT";
  if (s.startsWith("NPCI")) return "NPCI";
  if (s.startsWith("EKYCHUB")) return "EKYCHUB";
  return s;
};
const PAYOUT_MODE_PROVIDER = { IMPS: "SAMEDAY", NEFT: "SAMEDAY", RTGS: "SAMEDAY", UPI: "RAZORPAY" };

console.log("=== RECENT PAYOUT REQUESTS ===");
const payouts = await p.payoutRequest.findMany({
  orderBy: { createdAt: "desc" },
  take: 5,
  select: { id: true, userId: true, mode: true, amount: true, status: true, createdAt: true },
});
for (const po of payouts) {
  console.log(`${po.createdAt.toISOString()} id=${po.id} user=${po.userId} mode=${po.mode} amount=${num(po.amount)} status=${po.status}`);
}

if (payouts.length === 0) { console.log("No payouts found."); await p.$disconnect(); process.exit(0); }

const target = payouts.find((x) => x.status === "SUCCESS") ?? payouts[0];
const amt = num(target.amount);
const provider = PAYOUT_MODE_PROVIDER[target.mode] ?? "SAMEDAY";
console.log(`\n=== ANALYZING payout ${target.id} (user=${target.userId}, amount=${amt}, mode=${target.mode}, provider=${provider}) ===`);

// Walk the chain (same logic as resolvePricingChain)
const NETWORK_ROLES = new Set(["RETAILER","DISTRIBUTOR","MASTER_DISTRIBUTOR","SUPER_DISTRIBUTOR"]);
let cur = target.userId;
const seen = new Set();
for (let i = 0; i < 4 && cur && !seen.has(cur); i++) {
  seen.add(cur);
  const u = await p.user.findUnique({
    where: { id: cur },
    select: { id: true, name: true, role: true, status: true, schemeId: true, parentId: true },
  });
  if (!u) { console.log(`L${i} <user ${cur} not found>`); break; }
  if (u.status === "CLOSED" || !NETWORK_ROLES.has(u.role)) {
    console.log(`L${i} ${u.role} ${u.name} STOP (status=${u.status}, networkRole=${NETWORK_ROLES.has(u.role)})`);
    break;
  }

  let line = `L${i} ${u.role} ${u.name} (${u.id}) schemeId=${u.schemeId ?? "NULL"}`;
  if (!u.schemeId) {
    console.log(line + " :: NO SCHEME ASSIGNED");
  } else {
    const sc = await p.scheme.findUnique({ where: { id: u.schemeId }, select: { name: true, active: true } });
    line += ` scheme='${sc?.name}' active=${sc?.active}`;
    console.log(line);
    // ALL payout slabs (regardless of active) for visibility
    const slabs = await p.schemeSlab.findMany({
      where: { schemeId: u.schemeId, service: "PAYOUT" },
      select: { active: true, provider: true, minAmount: true, maxAmount: true, chargeType: true, chargeValue: true, commissionType: true, commissionValue: true },
      orderBy: { minAmount: "asc" },
    });
    if (slabs.length === 0) console.log(`     !! NO PAYOUT slabs in this scheme`);
    for (const s of slabs) {
      const inBand = amt >= num(s.minAmount) && amt <= num(s.maxAmount);
      const provMatch = norm(s.provider) === norm(provider) || s.provider == null;
      console.log(`     ${JSON.stringify({ active: s.active, provider: s.provider, normProvider: norm(s.provider), band: `${num(s.minAmount)}-${num(s.maxAmount)}`, charge: `${s.chargeType} ${num(s.chargeValue)}`, comm: `${s.commissionType} ${num(s.commissionValue)}`, inBand, provMatch, WOULD_MATCH: (s.active && inBand && provMatch) })}`);
    }
  }
  cur = u.parentId;
}

// Check synthetic txn + credits
console.log(`\n=== COMMISSION STATE ===`);
const synthRef = `PYC${target.id.slice(-10).toUpperCase()}`;
const txn = await p.transaction.findUnique({ where: { refId: synthRef }, select: { id: true, commission: true } });
if (!txn) {
  console.log(`No synthetic txn found (${synthRef}) -> distributeCommission likely never ran or threw before create`);
} else {
  const cc = await p.commissionCredit.findMany({ where: { transactionId: txn.id }, select: { userId: true, tier: true, grossAmount: true, amount: true } });
  console.log(`synth=${synthRef} txnId=${txn.id} txnCommission=${num(txn.commission)} credits=${cc.length}`);
  console.log(JSON.stringify(cc.map((c) => ({ tier: c.tier, gross: num(c.grossAmount), net: num(c.amount) })), null, 2));
}

await p.$disconnect();
