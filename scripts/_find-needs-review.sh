#!/bin/bash
cd /home/ubuntu/paybridgex
# Find all NEEDS_REVIEW service transactions and print their refIds
./node_modules/.bin/tsx -e "
import { prisma } from './src/lib/db';
async function run() {
  const rows = await prisma.transaction.findMany({
    where: { status: 'NEEDS_REVIEW' },
    orderBy: { createdAt: 'asc' },
    select: { refId: true, service: true, partner: true, createdAt: true, amount: true, fee: true, errorCode: true }
  });
  if (!rows.length) { console.log('NO_NEEDS_REVIEW_TXNS'); }
  else { rows.forEach(r => console.log(r.refId + '|' + r.service + '|' + r.partner + '|' + r.createdAt.toISOString() + '|' + r.errorCode)); }
  await prisma.\$disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
" 2>&1
