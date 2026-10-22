// Check payout status from DB + SameDay settlement API
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const p = new PrismaClient();

const PAYOUT_ID = process.argv[2] || "cmvhttfmm000q60o5qfef6oe9";

function sign(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

async function samedayGet(path, params) {
  const apiKey = process.env.SAMEDAY_SETTLEMENT_API_KEY || process.env.SAMEDAY_POS_API_KEY;
  const apiSecret = process.env.SAMEDAY_SETTLEMENT_API_SECRET || process.env.SAMEDAY_POS_API_SECRET;
  const baseUrl = (process.env.SAMEDAY_API_BASE_URL || "https://api.samedaysolution.in").replace(/\/$/, "");
  if (!apiKey || !apiSecret) throw new Error("SameDay API keys not configured");

  const qs = new URLSearchParams(params).toString();
  const url = `${baseUrl}${path}${qs ? "?" + qs : ""}`;
  const bodyString = "";
  const timestamp = Date.now().toString();
  const headers = {
    "x-api-key": apiKey,
    "x-signature": sign(apiSecret, bodyString + timestamp),
    "x-timestamp": timestamp,
    "Content-Type": "application/json",
  };
  const res = await fetch(url, { headers });
  return res.json();
}

(async () => {
  try {
    // 1. Get payout from DB
    const row = await p.payoutRequest.findUnique({
      where: { id: PAYOUT_ID },
      select: {
        id: true, status: true, mode: true, amount: true, totalDebit: true,
        beneficiaryName: true, accountLast4: true,
        providerReferenceId: true, providerTxnId: true,
        utr: true, failureReason: true,
        createdAt: true, processedAt: true, completedAt: true,
        response: true,
        user: { select: { userCode: true, name: true, phone: true } }
      }
    });

    if (!row) { console.log("Payout NOT FOUND in database"); return; }

    console.log("=== PAYOUT FROM DATABASE ===");
    console.log("ID:          ", row.id);
    console.log("Status:      ", row.status);
    console.log("Mode:        ", row.mode);
    console.log("Amount:      ", Number(row.amount));
    console.log("Total Debit: ", Number(row.totalDebit));
    console.log("Beneficiary: ", row.beneficiaryName, "••" + row.accountLast4);
    console.log("Our Ref:     ", row.providerReferenceId);
    console.log("Rail Ref:    ", row.providerTxnId || "(LOST)");
    console.log("UTR:         ", row.utr || "(none)");
    console.log("Failure:     ", row.failureReason || "(none)");
    console.log("Created:     ", row.createdAt);
    console.log("Processed:   ", row.processedAt);
    console.log("Completed:   ", row.completedAt);
    console.log("User:        ", row.user?.name, row.user?.userCode, row.user?.phone);
    if (row.response && Object.keys(row.response).length > 0) {
      console.log("Response:    ", JSON.stringify(row.response, null, 2));
    }

    // 2. Query SameDay settlement list
    console.log("\n=== SAMEDAY SETTLEMENT LIST (last 50) ===");
    const listData = await samedayGet("/api/partner/settlement/status", { list: "true", limit: "50" });

    if (!listData.success || !listData.transactions) {
      console.log("List API error:", listData.error?.message || JSON.stringify(listData));
    } else {
      const targetAmount = Number(row.amount);
      const last4 = row.accountLast4;
      console.log(`Total transactions returned: ${listData.transactions.length}`);
      console.log(`Searching for: amount=₹${targetAmount}, account=••${last4}\n`);

      // Match by amount
      const amountMatches = listData.transactions.filter(t =>
        Math.abs(t.amount - targetAmount) < 1
      );

      // Match by account last4
      const exactMatches = amountMatches.filter(t => {
        const tLast4 = (t.account_number || "").replace(/\D/g, "").slice(-4);
        return !last4 || !tLast4 || tLast4 === last4;
      });

      if (exactMatches.length === 0) {
        console.log("❌ NO matching transactions found in SameDay list by amount+account");
        if (amountMatches.length > 0) {
          console.log(`   (Found ${amountMatches.length} by amount alone — different accounts)`);
          amountMatches.forEach(t => {
            const acct = (t.account_number || "????").slice(-4);
            console.log(`   ₹${t.amount} | ••${acct} | ${t.status} | ref=${t.reference_id} | ${t.created_at}`);
          });
        }
      } else {
        console.log(`✅ Found ${exactMatches.length} match(es):\n`);
        exactMatches.forEach((t, i) => {
          console.log(`  --- Match ${i + 1} ---`);
          console.log(`  reference_id: ${t.reference_id}`);
          console.log(`  order_id:     ${t.order_id || "-"}`);
          console.log(`  amount:       ₹${t.amount}`);
          console.log(`  status:       ${t.status}`);
          console.log(`  utr:          ${t.utr || "-"}`);
          console.log(`  account:      ${t.account_number || "(hidden)"}`);
          console.log(`  holder:       ${t.account_holder_name || "-"}`);
          console.log(`  narration:    ${t.narration || "-"}`);
          console.log(`  created_at:   ${t.created_at}`);
          console.log();
        });
      }

      // Show all txns around payout time for context
      const payoutTime = new Date(row.processedAt || row.createdAt).getTime();
      const nearby = listData.transactions.filter(t => {
        if (!t.created_at) return false;
        return Math.abs(new Date(t.created_at).getTime() - payoutTime) < 4 * 3600000;
      });
      if (nearby.length > 0 && nearby.length !== exactMatches.length) {
        console.log("=== ALL TRANSACTIONS ±4h AROUND PAYOUT TIME ===");
        nearby.forEach(t => {
          const acct = (t.account_number || "").slice(-4);
          console.log(`  ${t.created_at} | ₹${t.amount} | ${t.status} | ••${acct} | ref=${t.reference_id} | utr=${t.utr || "-"}`);
        });
      }
    }

    // 3. If providerTxnId exists, poll direct status
    if (row.providerTxnId) {
      console.log("\n=== SAMEDAY STATUS BY REFERENCE ===");
      const data = await samedayGet("/api/partner/settlement/status", { reference_id: row.providerTxnId });
      console.log(JSON.stringify(data, null, 2));
    }

  } finally {
    await p.$disconnect();
  }
})();
