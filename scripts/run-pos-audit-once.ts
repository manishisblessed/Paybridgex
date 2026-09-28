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
(async () => {
  const { runPosSettlementIntegrityAudit } = await import("../src/lib/recon/posSettlement");
  const r = await runPosSettlementIntegrityAudit();
  console.log(JSON.stringify({ entriesChecked: r.entriesChecked, findings: r.findings.length, ok: r.ok, detail: r.findings }, null, 2));
  const { prisma } = await import("../src/lib/db");
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
