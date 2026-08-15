/**
 * One-shot asset pipeline for the official K.A. Paybridgex logos.
 *
 * Input:  src/logos/logo.jpeg (light bg), src/logos/logo_dark.jpeg (dark bg)
 * Output: transparent full lockups, emblem-only marks, web icons and
 *         Expo mobile assets.
 *
 * Run with: node scripts/processLogos.mjs
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_LIGHT = path.join(ROOT, "src/logos/logo.jpeg");
const SRC_DARK = path.join(ROOT, "src/logos/logo_dark.jpeg");

/**
 * Remove the solid background by flood-filling from every border pixel.
 * Only pixels connected to the border are cleared, so white/black details
 * inside the artwork survive.
 */
async function removeBackground(file, { dark }) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const isBg = (i) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return dark ? r <= 40 && g <= 40 && b <= 40 : r >= 225 && g >= 225 && b >= 225;
  };

  const visited = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x++) {
    queue.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    queue.push(y * width, y * width + width - 1);
  }

  while (queue.length) {
    const p = queue.pop();
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!isBg(i)) continue;
    data[i + 3] = 0;
    const x = p % width;
    const y = (p / width) | 0;
    if (x > 0) queue.push(p - 1);
    if (x < width - 1) queue.push(p + 1);
    if (y > 0) queue.push(p - width);
    if (y < height - 1) queue.push(p + width);
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png();
}

/** Trim fully transparent edges. */
function trimmed(img) {
  return img.trim({ threshold: 10 });
}

/**
 * Find the transparent gap between the emblem and the wordmark by scanning
 * row occupancy, then crop the emblem and pad it to a square.
 */
async function extractEmblem(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const occupancy = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 20) count++;
    }
    occupancy[y] = count;
  }

  // Look for the widest near-empty horizontal band in the middle-lower area.
  const from = Math.floor(height * 0.45);
  const to = Math.floor(height * 0.92);
  const emptyLimit = width * 0.01;
  let best = { start: -1, len: 0 };
  let runStart = -1;
  for (let y = from; y <= to; y++) {
    if (occupancy[y] <= emptyLimit) {
      if (runStart === -1) runStart = y;
      const len = y - runStart + 1;
      if (len > best.len) best = { start: runStart, len };
    } else {
      runStart = -1;
    }
  }

  const cutY = best.start > 0 ? best.start + Math.floor(best.len / 2) : Math.floor(height * 0.72);

  const emblem = await trimmed(
    sharp(await sharp(data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer())
      .extract({ left: 0, top: 0, width, height: cutY })
  ).png().toBuffer();

  // Pad to square, centred.
  const meta = await sharp(emblem).metadata();
  const side = Math.max(meta.width, meta.height);
  return sharp(emblem)
    .extend({
      top: Math.floor((side - meta.height) / 2),
      bottom: Math.ceil((side - meta.height) / 2),
      left: Math.floor((side - meta.width) / 2),
      right: Math.ceil((side - meta.width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
}

/** Place `inner` (buffer) centred on a canvas of `size`, scaled to `scale` of it. */
async function onCanvas(inner, size, scale, background) {
  const target = Math.round(size * scale);
  const resized = await sharp(inner)
    .resize(target, target, { fit: "inside" })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: resized, gravity: "centre" }])
    .png();
}

async function main() {
  await mkdir(path.join(ROOT, "mobile_app/assets"), { recursive: true });

  // 1. Full lockups with transparent backgrounds
  const lightFull = await trimmed(await removeBackground(SRC_LIGHT, { dark: false })).png().toBuffer();
  const darkFull = await trimmed(await removeBackground(SRC_DARK, { dark: true })).png().toBuffer();
  await sharp(lightFull).toFile(path.join(ROOT, "public/brand-logo.png"));
  await sharp(darkFull).toFile(path.join(ROOT, "public/brand-logo-dark.png"));

  // 2. Emblem-only square marks
  const lightMark = await extractEmblem(lightFull);
  const darkMark = await extractEmblem(darkFull);
  await sharp(lightMark).resize(512, 512, { fit: "inside" }).toFile(path.join(ROOT, "public/brand-mark.png"));
  await sharp(darkMark).resize(512, 512, { fit: "inside" }).toFile(path.join(ROOT, "public/brand-mark-dark.png"));

  // 3. Web app icons (Next.js app dir conventions)
  await (await onCanvas(lightMark, 512, 0.92)).toFile(path.join(ROOT, "src/app/icon.png"));
  await (await onCanvas(lightMark, 180, 0.78, { r: 255, g: 255, b: 255, alpha: 1 })).toFile(
    path.join(ROOT, "src/app/apple-icon.png")
  );

  // 4. Expo mobile assets referenced by mobile_app/app.json
  await (await onCanvas(lightMark, 1024, 0.72, { r: 255, g: 255, b: 255, alpha: 1 })).toFile(
    path.join(ROOT, "mobile_app/assets/icon.png")
  );
  await (await onCanvas(darkMark, 1024, 0.55)).toFile(path.join(ROOT, "mobile_app/assets/adaptive-icon.png"));
  // splash: dark lockup on transparency — app.json paints #131b4e behind it
  const splashLogo = await sharp(darkFull).resize(700, 700, { fit: "inside" }).png().toBuffer();
  await sharp({
    create: { width: 1284, height: 2778, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: splashLogo, gravity: "centre" }])
    .png()
    .toFile(path.join(ROOT, "mobile_app/assets/splash.png"));
  await (await onCanvas(lightMark, 48, 0.94)).toFile(path.join(ROOT, "mobile_app/assets/favicon.png"));

  console.log("All brand assets generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
