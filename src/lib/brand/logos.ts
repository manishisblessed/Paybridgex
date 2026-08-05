/**
 * Brand logo + colour resolver for banks, card issuers, telecoms and major
 * billers — used by the Bill Payment Report's logo column.
 *
 * Isomorphic (no server/client-only imports) so both the report table
 * (client) and the operator-logo seed (Node) can share one source of truth.
 *
 * Resolution strategy:
 *   1. Match the biller/bank display name against a curated keyword table.
 *   2. Known brand  → real logo via the logo CDN (`brandLogoUrl`).
 *   3. Any name     → a deterministic monogram badge with the brand's colour
 *                     when known, else a stable hashed palette (`brandBadge`).
 */

/** Logo CDN origin — must also be allow-listed in the CSP `img-src` (middleware). */
export const LOGO_CDN_ORIGIN = "https://logo.clearbit.com";

export type BrandBadge = { label: string; bg: string; fg: string };

type BrandDef = {
  /** Lower-cased substrings matched against the normalised name. */
  keywords: string[];
  /** Primary domain used to fetch the real logo from the CDN. */
  domain?: string;
  /** Explicit local-asset slug; defaults to the first label of `domain`. */
  slug?: string;
  /** Short monogram/wordmark shown when no image is available. */
  label: string;
  /** Brand background colour (hex). */
  bg: string;
  /** Brand foreground colour (hex); defaults to white. */
  fg?: string;
};

/** Public sub-directory (served from /public) where self-hosted logos live. */
export const LOCAL_LOGO_DIR = "/banks";

/**
 * Curated Indian bank / issuer / telecom / utility brands.
 *
 * ORDER MATTERS: `findBrand` returns the first match, and matching is a loose
 * substring test, so multi-word / more-specific brands (e.g. "SBI Card",
 * "HDFC Life") MUST appear before the generic bank they contain ("SBI",
 * "HDFC"). Keep the specific groups first.
 */
const BRANDS: BrandDef[] = [
  // ── Card issuers & fintech (before their parent banks) ──────────────
  { keywords: ["sbi card", "sbicard"], domain: "sbicard.com", label: "SBI CARD", bg: "#5C2D91" },
  { keywords: ["onecard", "one card"], domain: "getonecard.app", label: "OneCard", bg: "#111827" },
  { keywords: ["slice"], domain: "sliceit.com", label: "slice", bg: "#5B00E0" },
  { keywords: ["diners club", "diners"], domain: "dinersclub.com", label: "DINERS", bg: "#004A97" },
  { keywords: ["rupay"], domain: "rupay.co.in", label: "RuPay", bg: "#0B7A3B" },
  // ── Life & general insurance (before their parent banks) ────────────
  { keywords: ["hdfc life", "hdfc ergo"], domain: "hdfclife.com", label: "HDFC Life", bg: "#E4002B" },
  { keywords: ["icici prudential", "icici pru", "icici lombard"], domain: "iciciprulife.com", label: "ICICI Pru", bg: "#E97B25" },
  { keywords: ["sbi life"], domain: "sbilife.co.in", label: "SBI Life", bg: "#5C2D91" },
  { keywords: ["max life", "max bupa", "niva bupa"], domain: "maxlifeinsurance.com", label: "Max Life", bg: "#00518F" },
  { keywords: ["bajaj allianz"], domain: "bajajallianz.com", label: "Bajaj Allianz", bg: "#00539F" },
  { keywords: ["tata aia", "tata aig"], domain: "tataaia.com", label: "TATA AIA", bg: "#00204E" },
  { keywords: ["kotak life"], domain: "kotaklife.com", label: "Kotak Life", bg: "#ED1C24" },
  { keywords: ["star health"], domain: "starhealth.in", label: "STAR", bg: "#00A551" },
  { keywords: ["care health", "religare"], domain: "careinsurance.com", label: "CARE", bg: "#3AB54A" },
  { keywords: ["new india assurance"], domain: "newindia.co.in", label: "NIA", bg: "#1B4E9B" },
  { keywords: ["lic"], domain: "licindia.in", label: "LIC", bg: "#00518F" },
  // ── NBFC / loans ────────────────────────────────────────────────────
  { keywords: ["bajaj finserv", "bajaj finance"], domain: "bajajfinserv.in", label: "Bajaj", bg: "#00539F" },
  { keywords: ["muthoot"], domain: "muthootfinance.com", label: "Muthoot", bg: "#C8102E" },
  { keywords: ["manappuram"], domain: "manappuram.com", label: "MANAPPURAM", bg: "#00A0B0" },
  { keywords: ["shriram"], domain: "shriramfinance.in", label: "Shriram", bg: "#E4002B" },
  { keywords: ["cholamandalam", "chola"], domain: "cholamandalam.com", label: "CHOLA", bg: "#0072BC" },
  { keywords: ["tata capital"], domain: "tatacapital.com", label: "TATA Cap", bg: "#00204E" },
  { keywords: ["l t finance", "l&t finance"], domain: "ltfs.com", label: "L&T", bg: "#0B5CAB" },
  // ── Banks & card issuers ────────────────────────────────────────────
  { keywords: ["hdfc"], domain: "hdfcbank.com", label: "HDFC", bg: "#004C8F" },
  { keywords: ["icici"], domain: "icicibank.com", label: "ICICI", bg: "#AE282E" },
  { keywords: ["state bank", "sbi"], domain: "sbi.co.in", label: "SBI", bg: "#22409A" },
  { keywords: ["axis"], domain: "axisbank.com", label: "AXIS", bg: "#97144D" },
  { keywords: ["kotak"], domain: "kotak.com", label: "KOTAK", bg: "#ED1C24" },
  { keywords: ["yes bank", "yesbank"], domain: "yesbank.in", label: "YES", bg: "#00518F" },
  { keywords: ["punjab national", "pnb"], domain: "pnbindia.in", label: "PNB", bg: "#A20E37" },
  { keywords: ["bank of baroda", "baroda"], domain: "bankofbaroda.in", label: "BoB", bg: "#F15A22" },
  { keywords: ["canara"], domain: "canarabank.com", label: "CANARA", bg: "#00548E" },
  { keywords: ["union bank"], domain: "unionbankofindia.co.in", label: "UBI", bg: "#E4181F" },
  { keywords: ["idfc"], domain: "idfcfirstbank.com", label: "IDFC", bg: "#9C1D26" },
  { keywords: ["indusind"], domain: "indusind.com", label: "INDUS", bg: "#8A2432" },
  { keywords: ["federal bank", "federal"], domain: "federalbank.co.in", label: "FED", bg: "#F58220" },
  { keywords: ["rbl"], domain: "rblbank.com", label: "RBL", bg: "#C8102E" },
  { keywords: ["standard chartered", "stanchart"], domain: "sc.com", label: "SC", bg: "#0473EA" },
  { keywords: ["hsbc"], domain: "hsbc.co.in", label: "HSBC", bg: "#DB0011" },
  { keywords: ["citibank", "citi bank"], domain: "citibank.com", label: "CITI", bg: "#003B70" },
  { keywords: ["au small", "au bank"], domain: "aubank.in", label: "AU", bg: "#5A2D81" },
  { keywords: ["bandhan"], domain: "bandhanbank.com", label: "BANDHAN", bg: "#B01E23" },
  { keywords: ["idbi"], domain: "idbibank.in", label: "IDBI", bg: "#006A4D" },
  { keywords: ["central bank"], domain: "centralbankofindia.co.in", label: "CBI", bg: "#1B75BB" },
  { keywords: ["indian overseas", "iob"], domain: "iob.in", label: "IOB", bg: "#1B4E9B" },
  { keywords: ["indian bank"], domain: "indianbank.in", label: "IB", bg: "#1B3F8B" },
  { keywords: ["uco"], domain: "ucobank.com", label: "UCO", bg: "#1069B4" },
  { keywords: ["bank of india"], domain: "bankofindia.co.in", label: "BOI", bg: "#F26522" },
  { keywords: ["bank of maharashtra", "maharashtra bank"], domain: "bankofmaharashtra.in", label: "BoM", bg: "#F7941E" },
  { keywords: ["karnataka bank"], domain: "karnatakabank.com", label: "KBL", bg: "#EC1C24" },
  { keywords: ["south indian"], domain: "southindianbank.com", label: "SIB", bg: "#E1251B" },
  { keywords: ["dbs"], domain: "dbs.com", label: "DBS", bg: "#EB0029" },
  { keywords: ["american express", "amex"], domain: "americanexpress.com", label: "AMEX", bg: "#006FCF" },
  { keywords: ["punjab & sind", "punjab and sind"], domain: "punjabandsindbank.co.in", label: "P&SB", bg: "#8A1538" },
  { keywords: ["dcb bank"], domain: "dcbbank.com", label: "DCB", bg: "#005596" },
  { keywords: ["city union", "cub bank"], domain: "cityunionbank.com", label: "CUB", bg: "#C8102E" },
  { keywords: ["karur vysya", "kvb"], domain: "kvb.co.in", label: "KVB", bg: "#0072BC" },
  { keywords: ["tamilnad mercantile", "tmb"], domain: "tmb.in", label: "TMB", bg: "#12326E" },
  { keywords: ["csb bank", "catholic syrian"], domain: "csb.co.in", label: "CSB", bg: "#00539F" },
  { keywords: ["jammu", "kashmir bank", "j&k bank"], domain: "jkbank.com", label: "J&K", bg: "#8A1538" },
  { keywords: ["dhanlaxmi"], domain: "dhanbank.com", label: "DHAN", bg: "#E4181F" },
  // ── Small finance & payments banks ──────────────────────────────────
  { keywords: ["equitas"], domain: "equitasbank.com", label: "EQUITAS", bg: "#E4002B" },
  { keywords: ["ujjivan"], domain: "ujjivansfb.in", label: "UJJIVAN", bg: "#00A551" },
  { keywords: ["jana small", "jana bank"], domain: "janabank.com", label: "JANA", bg: "#652D86" },
  { keywords: ["utkarsh"], domain: "utkarsh.bank", label: "UTKARSH", bg: "#0072BC" },
  { keywords: ["suryoday"], domain: "suryodaybank.com", label: "SURYODAY", bg: "#F58220" },
  { keywords: ["esaf"], domain: "esafbank.com", label: "ESAF", bg: "#00A551" },
  { keywords: ["unity small", "unity bank"], domain: "theunitybank.com", label: "UNITY", bg: "#5A2D81" },
  { keywords: ["ippb", "india post payments"], domain: "ippbonline.com", label: "IPPB", bg: "#C8102E" },
  { keywords: ["paytm payments", "paytm bank"], domain: "paytmbank.com", label: "Paytm", bg: "#00BAF2" },
  { keywords: ["fino"], domain: "finobank.com", label: "FINO", bg: "#00539F" },
  { keywords: ["airtel payments"], domain: "airtel.in", label: "APB", bg: "#E40000" },
  // ── Cooperative banks ───────────────────────────────────────────────
  { keywords: ["saraswat"], domain: "saraswatbank.com", label: "SARASWAT", bg: "#00539F" },
  { keywords: ["cosmos bank"], domain: "cosmosbank.com", label: "COSMOS", bg: "#C8102E" },
  { keywords: ["tjsb"], domain: "tjsbbank.co.in", label: "TJSB", bg: "#0072BC" },
  // ── Telecom / broadband / DTH ───────────────────────────────────────
  { keywords: ["airtel"], domain: "airtel.in", label: "AIRTEL", bg: "#E40000" },
  { keywords: ["jio"], domain: "jio.com", label: "JIO", bg: "#0A2885" },
  { keywords: ["vodafone", "vi ", "idea "], domain: "myvi.in", label: "Vi", bg: "#EB1600" },
  { keywords: ["bsnl"], domain: "bsnl.co.in", label: "BSNL", bg: "#F58220" },
  { keywords: ["mtnl"], domain: "mtnl.net.in", label: "MTNL", bg: "#0072BC" },
  { keywords: ["act fibernet", "act broadband"], domain: "actcorp.in", label: "ACT", bg: "#ED1C24" },
  { keywords: ["hathway"], domain: "hathway.com", label: "HATHWAY", bg: "#ED1B2F" },
  { keywords: ["excitel"], domain: "excitel.com", label: "EXCITEL", bg: "#F7941E" },
  { keywords: ["spectra"], domain: "spectra.co", label: "SPECTRA", bg: "#00A6E2" },
  { keywords: ["tikona"], domain: "tikona.in", label: "TIKONA", bg: "#009639" },
  { keywords: ["you broadband"], domain: "youbroadband.in", label: "YOU", bg: "#ED1C24" },
  { keywords: ["gtpl"], domain: "gtpl.net", label: "GTPL", bg: "#0072BC" },
  { keywords: ["den network", "den broadband"], domain: "denonline.in", label: "DEN", bg: "#ED1C24" },
  { keywords: ["tata play", "tata sky"], domain: "tataplay.com", label: "TATA Play", bg: "#00204E" },
  { keywords: ["dish tv", "dishtv"], domain: "dishtv.in", label: "DISH", bg: "#E5241B" },
  { keywords: ["sun direct"], domain: "sundirect.in", label: "SUN", bg: "#F58220" },
  { keywords: ["d2h", "videocon"], domain: "d2h.com", label: "d2h", bg: "#ED1C24" },
  // ── Power boards / DISCOMs ──────────────────────────────────────────
  { keywords: ["tata power"], domain: "tatapower.com", label: "TATA Power", bg: "#486AAE" },
  { keywords: ["adani"], domain: "adani.com", label: "ADANI", bg: "#6C2D91" },
  { keywords: ["torrent power", "torrent"], domain: "torrentpower.com", label: "TORRENT", bg: "#00A0E3" },
  { keywords: ["bses", "bses rajdhani", "bses yamuna"], domain: "bsesdelhi.com", label: "BSES", bg: "#1F9BD7" },
  { keywords: ["msedcl", "mahadiscom", "maharashtra state electricity"], domain: "mahadiscom.in", label: "MSEDCL", bg: "#1B6CB5" },
  { keywords: ["cesc"], domain: "cesc.co.in", label: "CESC", bg: "#00539F" },
  { keywords: ["kseb", "kerala state electricity"], domain: "kseb.in", label: "KSEB", bg: "#C8102E" },
  { keywords: ["tangedco", "tneb", "tamil nadu electricity"], domain: "tangedco.gov.in", label: "TNEB", bg: "#0072BC" },
  { keywords: ["pspcl", "punjab state power"], domain: "pspcl.in", label: "PSPCL", bg: "#00539F" },
  { keywords: ["uppcl", "uttar pradesh power"], domain: "uppcl.org", label: "UPPCL", bg: "#0B5CAB" },
  { keywords: ["bescom"], domain: "bescom.karnataka.gov.in", label: "BESCOM", bg: "#009639" },
  { keywords: ["wbsedcl"], domain: "wbsedcl.in", label: "WBSEDCL", bg: "#0072BC" },
  { keywords: ["jvvnl", "jaipur vidyut"], domain: "energy.rajasthan.gov.in", slug: "jvvnl", label: "JVVNL", bg: "#C8102E" },
  // ── Gas ─────────────────────────────────────────────────────────────
  { keywords: ["indane"], domain: "indane.co.in", label: "INDANE", bg: "#E1251B" },
  { keywords: ["hp gas", "hindustan petroleum"], domain: "hindustanpetroleum.com", label: "HP", bg: "#0072BC" },
  { keywords: ["bharat gas", "bharat petroleum"], domain: "bharatpetroleum.in", label: "BPCL", bg: "#FDB913", fg: "#111827" },
  { keywords: ["mahanagar gas", "mgl"], domain: "mahanagargas.com", label: "MGL", bg: "#00A551" },
  { keywords: ["indraprastha gas", "igl"], domain: "iglonline.net", label: "IGL", bg: "#00539F" },
  { keywords: ["gujarat gas"], domain: "gujaratgas.com", label: "GUJ GAS", bg: "#ED1C24" },
];

/** Stable palette for brands not in the curated table. */
const FALLBACK_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: "#1e3a8a", fg: "#ffffff" },
  { bg: "#047857", fg: "#ffffff" },
  { bg: "#6d28d9", fg: "#ffffff" },
  { bg: "#b45309", fg: "#ffffff" },
  { bg: "#be123c", fg: "#ffffff" },
  { bg: "#0f766e", fg: "#ffffff" },
];

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findBrand(name: string): BrandDef | null {
  const n = ` ${normalize(name)} `;
  if (n.trim().length === 0) return null;
  for (const b of BRANDS) {
    if (b.keywords.some((k) => n.includes(` ${k.trim()}`) || n.includes(k))) return b;
  }
  return null;
}

/** Real logo URL for a known brand name, or null when unmatched. */
export function brandLogoUrl(name: string | null | undefined): string | null {
  if (!name) return null;
  const b = findBrand(name);
  return b?.domain ? `${LOGO_CDN_ORIGIN}/${b.domain}` : null;
}

function slugForDomain(domain?: string): string | null {
  if (!domain) return null;
  return domain.split(".")[0] || null;
}

/** Stable slug used for a brand's self-hosted logo filename. */
export function brandSlug(name: string | null | undefined): string | null {
  if (!name) return null;
  const b = findBrand(name);
  if (!b) return null;
  return b.slug ?? slugForDomain(b.domain);
}

/**
 * Candidate self-hosted logo paths for a brand (SVG preferred, then PNG),
 * served from `/public${LOCAL_LOGO_DIR}`. Empty when the name is unknown.
 * These are tried before the CDN so operators can override with their own art.
 */
export function brandLocalLogos(name: string | null | undefined): string[] {
  const slug = brandSlug(name);
  if (!slug) return [];
  return [`${LOCAL_LOGO_DIR}/${slug}.svg`, `${LOCAL_LOGO_DIR}/${slug}.png`];
}

/**
 * Deduped list of every self-hosted logo asset (slug + badge colours/label),
 * used to pre-generate placeholder SVGs under `/public${LOCAL_LOGO_DIR}`.
 * On a slug collision (e.g. shared domain) the later brand wins.
 */
export function brandAssetList(): Array<{ slug: string; label: string; bg: string; fg: string }> {
  const bySlug = new Map<string, { slug: string; label: string; bg: string; fg: string }>();
  for (const b of BRANDS) {
    const slug = b.slug ?? slugForDomain(b.domain);
    if (!slug) continue;
    bySlug.set(slug, { slug, label: b.label, bg: b.bg, fg: b.fg ?? "#ffffff" });
  }
  return [...bySlug.values()];
}

/**
 * Deterministic monogram badge for a name: brand wordmark + colour when known,
 * otherwise stable hashed initials. Always renders something meaningful.
 */
export function brandBadge(name: string | null | undefined): BrandBadge {
  const b = name ? findBrand(name) : null;
  if (b) return { label: b.label, bg: b.bg, fg: b.fg ?? "#ffffff" };

  const s = normalize(name ?? "");
  const initials =
    s
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pal = FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
  return { label: initials, bg: pal.bg, fg: pal.fg };
}
