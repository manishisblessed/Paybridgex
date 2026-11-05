const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    const txnIds = [
      'cmw0htx3c003h4sx7ryvtqthc', // TXNOTQ9_ICMWH - FAILED (09:36, PAYMENT_FAILED)
      'cmw0nhl6d007e3ibmtxh9c798', // TXNGMPCYOQPAW - FAILED (12:14, PAYMENT_PENDING, original pay)
      'cmw0nozqu00873ibmxplrba07', // TXNRJ5VPPLI6T - FAILED (12:20, idempotent_replay)
      'cmw0npna2008k3ibmzroclkbu', // TXNLWTVLGYL5N - NEEDS_REVIEW (12:21, HTTP_429, ₹49,000)
    ];

    for (const txnId of txnIds) {
      const txn = await p.transaction.findUnique({
        where: { id: txnId },
        select: { refId: true, status: true, amount: true, fee: true, errorCode: true, createdAt: true }
      });
      console.log(`\n=== ${txn.refId} (${txn.status}) ₹${txn.amount} + ₹${txn.fee} fee [${txn.errorCode}] ===`);

      const walletTxns = await p.walletTxn.findMany({
        where: { refType: 'Transaction', refId: txnId },
        select: { amount: true, direction: true, reason: true, createdAt: true, idempotencyKey: true },
        orderBy: { createdAt: 'asc' }
      });
      if (walletTxns.length === 0) {
        console.log('  No wallet transactions');
      } else {
        walletTxns.forEach(w => console.log(`  ${w.direction} ₹${w.amount} (${w.reason}) at ${w.createdAt.toISOString()}`));
      }

      const liens = await p.walletLien.findMany({
        where: { refType: 'Transaction', refId: txnId },
        select: { id: true, amount: true, recoveredAmount: true, status: true }
      });
      if (liens.length > 0) {
        liens.forEach(l => console.log(`  LIEN: ${l.id} ₹${l.amount} recovered:₹${l.recoveredAmount} status:${l.status}`));
      }
    }

    // Show user's current balance
    const user = await p.user.findUnique({
      where: { id: 'cmtybkldp004mqlvhofja9g95' }, // check RT0101 user id
      select: { name: true, walletBalance: true, heldBalance: true, lienBalance: true }
    });

    // Get RT0101 user
    const rt0101 = await p.user.findFirst({
      where: { userCode: 'RT0101' },
      select: { id: true, name: true, walletBalance: true, heldBalance: true, lienBalance: true }
    });
    console.log('\n=== RT0101 User Balance ===');
    console.log(JSON.stringify(rt0101, null, 2));

  } catch(e) { console.error(e); }
  process.exit(0);
})();
