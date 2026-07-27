/**
 * Audit POS card-classification coverage per acquiring company.
 *
 * Transactions are NOT stored locally — they come live from the Same Day feed.
 * This attributes each CARD transaction to a company via
 *   transaction.terminal_id -> PosMachine.tid -> PosMachine.company
 * and reports, per company:
 *   - total  : CARD transactions seen
 *   - feed   : rows the acquirer feed already classified (card_classification)
 *   - blank  : rows with no classification from the feed
 *   - binOk  : blanks whose 6-digit BIN is derivable from the (masked) PAN
 *   - binNo  : blanks where the BIN can't be derived (never fillable from BIN)
 *
 * With `--fill`, it also runs the eKYC Hub Card BIN Checker on every distinct
 * blank BIN (cache-first, so it WARMS CardBinCache) and reports, per company,
 * how many blank rows would become classified.
 *
 * Usage:
 *   npx tsx scripts/audit-pos-classification.ts [--days=90] [--fill]
 */
import "./_load-env";
import { prisma } from "@/lib/db";
import { getPosTransactions } from "@/lib/partners/sameday-pos";
import { ekychubConfigured } from "@/lib/partners/ekychub";
import { lookupBin, classificationFromBin } from "@/lib/pos/binLookup";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const has = (name: string) => process.argv.includes(`--${name}`);

const DAYS = Number(arg("days") ?? 90);
const DO_FILL = has("fill");

const binOf = (card: string | null | undefined) =>
  (card ?? "").replace(/\D/g, "").slice(0, 6);

type Stat = {
  total: number;
  feed: number;
  blank: number;
  binOk: number;
  binNo: number;
  fillable: number; // blanks whose BIN resolved to a classification (--fill only)
};
const newStat = (): Stat => ({ total: 0, feed: 0, blank: 0, binOk: 0, binNo: 0, fillable: 0 });

(async () => {
  const to = new Date();
  const from = new Date(to.getTime() - DAYS * 24 * 60 * 60 * 1000);
  const date_from = from.toISOString();
  const date_to = to.toISOString();

  console.log(`eKYC Hub configured : ${ekychubConfigured() ? "YES" : "NO"}`);
  console.log(`Window              : ${date_from}  ->  ${date_to} (${DAYS}d)`);
  console.log(`Mode                : ${DO_FILL ? "FILL (live BIN lookups + cache warm)" : "REPORT ONLY (no external calls)"}`);
  console.log("");

  const machines = await prisma.posMachine.findMany({ select: { tid: true, company: true } });
  const companyByTid = new Map<string, string>();
  for (const m of machines) {
    if (m.tid) companyByTid.set(m.tid, (m.company ?? "").trim() || "UNKNOWN_COMPANY");
  }

  const byCompany = new Map<string, Stat>();
  const bump = (c: string) => {
    let s = byCompany.get(c);
    if (!s) byCompany.set(c, (s = newStat()));
    return s;
  };

  // Remember, per distinct blank BIN, the (company -> blank row count) so a
  // single lookup result can be folded back into every affected company.
  const blankBinCompanies = new Map<string, Map<string, number>>();

  let page = 1;
  let scanned = 0;
  for (;;) {
    const res = await getPosTransactions({ date_from, date_to, page, page_size: 100 });
    if (!res.ok) {
      console.error(`FEED ERROR (page ${page}, HTTP ${res.status}):`, res.error.error?.message);
      break;
    }
    for (const t of res.data.data) {
      scanned++;
      if (t.payment_mode !== "CARD") continue;
      const company = companyByTid.get(t.terminal_id) ?? "UNMAPPED_TID";
      const s = bump(company);
      s.total++;
      if (t.card_classification) {
        s.feed++;
        continue;
      }
      s.blank++;
      const bin = binOf(t.card_number);
      if (bin.length === 6) {
        s.binOk++;
        let byC = blankBinCompanies.get(bin);
        if (!byC) blankBinCompanies.set(bin, (byC = new Map()));
        byC.set(company, (byC.get(company) ?? 0) + 1);
      } else {
        s.binNo++;
      }
    }
    if (!res.data.pagination?.has_next) break;
    page++;
  }

  console.log(`Scanned ${scanned} transactions across ${page} page(s).`);
  console.log(`Distinct blank BINs (derivable): ${blankBinCompanies.size}`);

  let binResolvedCount = 0;
  let binFailedCount = 0;
  if (DO_FILL && blankBinCompanies.size > 0) {
    if (!ekychubConfigured()) {
      console.log("\n--fill requested but eKYC Hub is NOT configured; skipping BIN lookups.");
    } else {
      const bins = [...blankBinCompanies.keys()];
      let done = 0;
      for (const bin of bins) {
        let label: string | undefined;
        try {
          const r = await lookupBin(bin);
          label = r ? classificationFromBin(r) : undefined;
        } catch {
          label = undefined;
        }
        if (label) {
          binResolvedCount++;
          for (const [company, count] of blankBinCompanies.get(bin)!) {
            bump(company).fillable += count;
          }
        } else {
          binFailedCount++;
        }
        if (++done % 25 === 0) console.log(`  ...BIN lookups ${done}/${bins.length}`);
      }
    }
  }
  console.log("");

  const rows = [...byCompany.entries()].sort((a, b) => b[1].total - a[1].total);
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const np = (n: number, w = 7) => String(n).padStart(w);
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(0) + "%" : "-");

  const head =
    pad("COMPANY", 30) + np(0).replace(/0/, " ") +
    "  total    feed   feed%   blank   binOk   binNo" +
    (DO_FILL ? "  fill  cover%" : "");
  console.log(head);
  console.log("-".repeat(DO_FILL ? 104 : 86));

  const tot = newStat();
  for (const [company, s] of rows) {
    tot.total += s.total; tot.feed += s.feed; tot.blank += s.blank;
    tot.binOk += s.binOk; tot.binNo += s.binNo; tot.fillable += s.fillable;
    let line =
      pad(company, 30) + np(s.total) + "  " + np(s.feed) + "   " +
      pct(s.feed, s.total).padStart(5) + "  " + np(s.blank) + "  " + np(s.binOk) + "  " + np(s.binNo);
    if (DO_FILL) {
      const cover = pct(s.feed + s.fillable, s.total);
      line += "  " + np(s.fillable, 4) + "  " + cover.padStart(5);
    }
    console.log(line);
  }
  console.log("-".repeat(DO_FILL ? 104 : 86));
  let tline =
    pad("TOTAL", 30) + np(tot.total) + "  " + np(tot.feed) + "   " +
    pct(tot.feed, tot.total).padStart(5) + "  " + np(tot.blank) + "  " + np(tot.binOk) + "  " + np(tot.binNo);
  if (DO_FILL) tline += "  " + np(tot.fillable, 4) + "  " + pct(tot.feed + tot.fillable, tot.total).padStart(5);
  console.log(tline);

  if (DO_FILL) {
    console.log("");
    console.log(`BIN checker: ${binResolvedCount} distinct BINs resolved, ${binFailedCount} failed/empty.`);
    console.log(`Resolved BINs are cached in CardBinCache, so the live UI/export will fill them.`);
  }

  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
