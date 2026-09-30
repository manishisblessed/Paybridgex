/**
 * Client-side image compression / downscaling before direct-to-Cloudinary
 * upload.
 *
 * With a paid Cloudinary plan the hard size limit is high (~100 MB), so this is
 * no longer about avoiding a size error — it's about reliability and cost:
 * shrinking multi-megabyte phone photos makes uploads fast and cheap (less
 * bandwidth/storage = fewer credits) while keeping documents perfectly legible.
 *
 * Guarantees:
 *  - Never throws for a normal document. If in-browser compression can't run
 *    (e.g. HEIC on Chrome, no canvas), the ORIGINAL file is returned and
 *    Cloudinary handles it server-side.
 *  - Only rejects absurdly large files (> MAX_FILE_BYTES), which indicate a
 *    wrong attachment rather than a real KYC document.
 *
 * Note: re-encoding strips EXIF (including embedded GPS). Callers that rely on
 * EXIF GPS must extract it from the ORIGINAL file before calling this. The live
 * GPS capture flow passes its fix separately, so it is unaffected.
 */

/** Compress images larger than this (bytes). Smaller images pass through as-is. */
const TARGET_IMAGE_BYTES = 6 * 1024 * 1024;

/**
 * Absolute cap for any single file. Comfortably under Cloudinary's ~100 MB
 * limit; anything larger is almost certainly a mistaken attachment.
 */
export const MAX_FILE_BYTES = 90 * 1024 * 1024;

/** Longest edge (px) we downscale to. ~200+ DPI for an A4 page — plenty legible. */
const MAX_LONG_EDGE = 2600;

/** JPEG quality steps tried, highest first, before shrinking dimensions. */
const QUALITY_STEPS = [0.85, 0.78, 0.7, 0.6];

/** Extra dimension-reduction passes if quality alone can't hit the target. */
const MAX_DIMENSION_PASSES = 3;

function toMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function decodeImage(
  file: File
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` honors EXIF orientation so rotated phone photos don't
      // come out sideways after re-encoding.
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
    } catch {
      // Fall back to <img> decoding below.
    }
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode-failed"));
    };
    img.src = url;
  });
}

function dimensionsOf(src: ImageBitmap | HTMLImageElement): {
  width: number;
  height: number;
} {
  if ("naturalWidth" in src) {
    return { width: src.naturalWidth, height: src.naturalHeight };
  }
  return { width: src.width, height: src.height };
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality)
  );
}

/**
 * Best-effort compression that returns the smallest acceptable JPEG it can
 * produce. Returns `null` if compression can't run at all (caller falls back to
 * the original file).
 */
async function compressImage(file: File): Promise<File | null> {
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await decodeImage(file);
  } catch {
    return null;
  }

  try {
    const { width, height } = dimensionsOf(src);
    if (!width || !height) return null;

    const initialScale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height));
    let targetW = Math.max(1, Math.round(width * initialScale));
    let targetH = Math.max(1, Math.round(height * initialScale));

    let best: File | null = null;

    for (let pass = 0; pass <= MAX_DIMENSION_PASSES; pass++) {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return best; // canvas unsupported — use whatever we have (maybe null)
      ctx.drawImage(src as CanvasImageSource, 0, 0, targetW, targetH);

      for (const quality of QUALITY_STEPS) {
        const blob = await canvasToJpegBlob(canvas, quality);
        if (!blob) continue;
        const candidate = new File(
          [blob],
          file.name.replace(/\.[^.]+$/, "") + ".jpg",
          { type: "image/jpeg", lastModified: Date.now() }
        );
        // Track the smallest candidate as a fallback.
        if (!best || candidate.size < best.size) best = candidate;
        if (candidate.size <= TARGET_IMAGE_BYTES) return candidate;
      }

      // Still above target — shrink dimensions and try again.
      targetW = Math.max(1, Math.round(targetW * 0.75));
      targetH = Math.max(1, Math.round(targetH * 0.75));
    }

    // Couldn't reach the target, but the smallest candidate is still far
    // smaller than the original and well within plan limits — use it.
    return best;
  } catch {
    return null;
  } finally {
    if ("close" in src && typeof src.close === "function") src.close();
  }
}

/**
 * Returns a file ready for upload. Large images are compressed; small images and
 * other file types pass through. Only absurdly large files are rejected.
 */
export async function prepareUploadFile(file: File): Promise<File> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `This file is ${toMB(file.size)} MB, which is too large. Please upload a file under ${toMB(
        MAX_FILE_BYTES
      )} MB — retake the photo or scan the document at a lower resolution.`
    );
  }

  // Non-images (PDFs, etc.) can't be safely recompressed in the browser.
  if (!file.type.startsWith("image/")) return file;

  // Already small enough — keep the original (and its EXIF) untouched.
  if (file.size <= TARGET_IMAGE_BYTES) return file;

  const compressed = await compressImage(file);
  // Fall back to the original if compression couldn't run (e.g. HEIC on Chrome);
  // Cloudinary will ingest and convert it server-side.
  return compressed ?? file;
}
