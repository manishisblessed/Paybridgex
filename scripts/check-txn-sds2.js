const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  try {
    // Search by card last4 '9006'
    console.log('=== Search by customer 9006 ===');
    const byCard = await p.transaction.findMany({
      where: { service: 'BILL_CREDIT_CARD', customer: '9006' },
      select: {
        id: true, refId: true, status: true, amount: true, fee: true,
        partnerTxnId: true, errorCode: true, customer: true, operator: true,
        request: true, response: true, createdAt: true,
        user: { select: { name: true, userCode: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log('Found:', byCard.length);
    byCard.forEach(r => console.log(JSON.stringify(r, null, 2)));

    // Search by phone number in request JSON
    console.log('\n=== Search by phone 9586260999 in request ===');
    const byPhone = await p.transaction.findMany({
      where: {
        service: 'BILL_CREDIT_CARD',
        request: { path: ['customerParams', 'customerNumber'], equals: '9586260999' }
      },
      select: {
        id: true, refId: true, status: true, amount: true, fee: true,
        partnerTxnId: true, errorCode: true, customer: true, operator: true,
        request: true, response: true, createdAt: true,
        user: { select: { name: true, userCode: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    console.log('Found:', byPhone.length);
    byPhone.forEach(r => console.log(JSON.stringify(r, null, 2)));

    // Also search for SDS ref in response JSON
    console.log('\n=== Search by response request_id SDS1793708097667 ===');
    const byRef = await p.transaction.findMany({
      where: {
        service: 'BILL_CREDIT_CARD',
        response: { path: ['request_id'], equals: 'SDS1793708097667' }
      },
      select: {
        id: true, refId: true, status: true, amount: true, partnerTxnId: true,
        request: true, response: true, createdAt: true
      },
      take: 5
    });
    console.log('Found:', byRef.length);
    byRef.forEach(r => console.log(JSON.stringify(r, null, 2)));

    // Check PartnerApiLog for the SDS ref
    console.log('\n=== Search PartnerApiLog for SDS1793708097667 ===');
    const apiLogs = await p.partnerApiLog.findMany({
      where: {
        OR: [
          { providerRef: 'SDS1793708097667' },
          { response: { path: ['request_id'], equals: 'SDS1793708097667' } }
        ]
      },
      select: {
        id: true, txnRefId: true, provider: true, method: true, path: true,
        request: true, response: true, ok: true, httpStatus: true, createdAt: true
      },
      take: 5
    });
    console.log('Found:', apiLogs.length);
    apiLogs.forEach(r => console.log(JSON.stringify(r, null, 2)));

  } catch(e) { console.error(e); }
  process.exit(0);
})();
