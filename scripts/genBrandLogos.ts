/**
 * Generate placeholder brand logo SVGs for every entry in the brand table.
 *
 * Each file is a clean rounded tile in the brand's colour with its wordmark,
 * written to `public/banks/<slug>.svg` — the exact path the report's logo
 * resolver looks for. Replace any file with the real logo later (same name);
 * PNGs work too (`<slug>.png`). Safe to re-run.
 *
 *   npm run gen:logos
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brandAssetList, LOCAL_LOGO_DIR } from "../src/lib/brand/logos";

const OUT_DIR = join(process.cwd(), "public", LOCAL_LOGO_DIR.replace(/^\/+/, ""));

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Font size that keeps the wordmark within the tile for any label length. */
function fontSize(label: string): number {
  const len = Math.max(label.length, 1);
  const bracket = len <= 3 ? 48 : len <= 5 ? 38 : len <= 7 ? 30 : 24;
  const fit = Math.floor(112 / (len * 0.62));
  return Math.max(14, Math.min(bracket, fit));
}

function svg({ label, bg, fg }: { label: string; bg: string; fg: string }): string {
  const t = esc(label);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="${t}">
  <rect width="128" height="128" rx="24" fill="${bg}"/>
  <text x="64" y="64" dy="0.35em" text-anchor="middle" font-family="'Segoe UI',Arial,Helvetica,sans-serif" font-weight="700" font-size="${fontSize(label)}" fill="${fg}">${t}</text>
</svg>
`;
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const assets = brandAssetList();
  for (const a of assets) {
    writeFileSync(join(OUT_DIR, `${a.slug}.svg`), svg(a), "utf8");
  }
  console.log(`✔ Generated ${assets.length} brand logo(s) → ${OUT_DIR}`);
}

main();
