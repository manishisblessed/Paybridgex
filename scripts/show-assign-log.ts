import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
for (const file of [".env.local", ".env"]) {
  const p = resolve(process.cwd(), file);
  if (!existsSync(p)) continue;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
const TID = (process.env.POS_TID ?? "19968433").trim();
(async () => {
  const { prisma } = await import("../src/lib/db");
  const m = await prisma.posMachine.findFirst({ where: { tid: TID }, select: { id: true, assignedUserId: true } });
  if (!m) { console.log("no machine"); await prisma.$disconnect(); return; }
  const logs = await prisma.posAssignmentLog.findMany({ where: { machineId: m.id }, orderBy: { createdAt: "asc" },
    select: { action: true, toUserId: true, fromUserId: true, status: true, createdAt: true, assignedDate: true, deliveredDate: true } });
  console.log(`TID ${TID} currentAssignedUserId=${m.assignedUserId}`);
  for (const l of logs) console.log(`createdAt=${l.createdAt?.toISOString()}  assignedDate=${l.assignedDate?.toISOString() ?? "—"}  delivered=${l.deliveredDate?.toISOString() ?? "—"}  action=${l.action}  status=${l.status}  to=${l.toUserId}  from=${l.fromUserId}`);
  await prisma.$disconnect();
})();
