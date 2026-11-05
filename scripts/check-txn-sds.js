const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    // Search by partnerTxnId, or by customer/amount matching
    const txns = await p.transaction.findMany({
      where: {
        OR: [
          { partnerTxnId: 'SDS1793708097667' },
          {
            AND: [
              { service: 'BILL_CREDIT_CARD' },
              { customer: { contains: '9006' } },
              { createdAt: { gte: new Date('2026-11-03T00:00:00Z') } }
            ]
          },
          {
            AND: [
              { service: 'BILL_CREDIT_CARD' },
              { amount: 49999 },
              { createdAt: { gte: new Date('2026-11-03T00:00:00Z') } }
            ]
          }
        ]
      },
      select: {
        id: true, refId: true, userId: true, service: true, partner: true,
        status: true, amount: true, fee: true, gst: true, vendorCharge: true,
        partnerTxnId: true, errorCode: true, errorMessage: true,
        operator: true, customer: true, request: true, response: true,
        createdAt: true, updatedAt: true,
        user: { select: { name: true, email: true, userCode: true } }
      },
      take: 10
    });
    console.log('Found:', txns.length);
    txns.forEach(t => console.log(JSON.stringify(t, null, 2)));

    // If not found, list all CC txns today
    if (txns.length === 0) {
      console.log('\nListing all BILL_CREDIT_CARD txns today...');
      const allCC = await p.transaction.findMany({
        where: {
          service: 'BILL_CREDIT_CARD',
          createdAt: { gte: new Date('2026-11-03T00:00:00Z') }
        },
        select: {
          id: true, refId: true, status: true, amount: true, fee: true,
          partnerTxnId: true, errorCode: true, customer: true, operator: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      });
      console.log('All CC txns today:', allCC.length);
      allCC.forEach(r => console.log(JSON.stringify(r)));
    }
  } catch(e) { console.error(e); }
  process.exit(0);
})();
