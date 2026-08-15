import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import crypto from "crypto";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

export { cloudinary };

/**
 * Upload a buffer / Base64 / data URL to Cloudinary inside a per-user
 * KYC folder. Returns metadata you can persist into `Document`.
 */
export async function uploadToCloudinary(
  fileOrDataUrl: string | Buffer,
  opts: {
    userId: string;
    type: string; // PAN | AADHAAR_FRONT | ...
    isSensitive?: boolean;
  }
): Promise<UploadApiResponse> {
  const folder = `paybridgex/${opts.isSensitive ? "private" : "public"}/${opts.userId}/${opts.type.toLowerCase()}`;

  const payload =
    typeof fileOrDataUrl === "string"
      ? fileOrDataUrl
      : `data:application/octet-stream;base64,${fileOrDataUrl.toString("base64")}`;

  return cloudinary.uploader.upload(payload, {
    folder,
    resource_type: "auto",
    // Sensitive docs stored as type=private and require signed URLs to view.
    type: opts.isSensitive ? "private" : "upload",
    overwrite: false,
    use_filename: false,
    unique_filename: true,
    invalidate: true
  });
}

/**
 * Upload a server-generated PDF (e.g. a signed declaration) into a private,
 * per-user folder. Stored as a private `image` asset so the original can be
 * retrieved later with a short-lived signed URL (see `signedPdfUrl`).
 */
export async function uploadPdfToCloudinary(
  buffer: Buffer,
  opts: { userId: string; type: string }
): Promise<UploadApiResponse> {
  const folder = `paybridgex/private/${opts.userId}/${opts.type.toLowerCase()}`;
  const payload = `data:application/pdf;base64,${buffer.toString("base64")}`;
  return cloudinary.uploader.upload(payload, {
    folder,
    resource_type: "image",
    type: "private",
    overwrite: false,
    use_filename: false,
    unique_filename: true,
    invalidate: true,
  });
}

/** Short-lived signed download URL for a private PDF stored via `uploadPdfToCloudinary`. */
export function signedPdfUrl(publicId: string, opts?: { expiresInSec?: number }) {
  const expires = Math.floor(Date.now() / 1000) + (opts?.expiresInSec ?? 60 * 5);
  return cloudinary.utils.private_download_url(publicId, "pdf", {
    resource_type: "image",
    type: "private",
    expires_at: expires,
  });
}

/** Generate a short-lived signed URL for a private (sensitive) asset. */
export function signedDeliveryUrl(publicId: string, opts?: { expiresInSec?: number; format?: string }) {
  const expires = Math.floor(Date.now() / 1000) + (opts?.expiresInSec ?? 60 * 5); // 5 min default
  return cloudinary.utils.private_download_url(publicId, opts?.format ?? "jpg", {
    type: "private",
    expires_at: expires
  });
}

/**
 * Build params for direct browser → Cloudinary upload (faster, cheaper than
 * routing big files through Vercel). Sign on the server, upload from the client.
 *
 * Client posts the file + these params to:
 *   https://api.cloudinary.com/v1_1/<cloud_name>/auto/upload
 */
export function getSignedUploadParams(opts: { userId: string; type: string; isSensitive?: boolean }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `paybridgex/${opts.isSensitive ? "private" : "public"}/${opts.userId}/${opts.type.toLowerCase()}`;

  const paramsToSign: Record<string, string | number | boolean> = {
    folder,
    timestamp,
    type: opts.isSensitive ? "private" : "upload"
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET!);

  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    timestamp,
    signature,
    folder,
    type: opts.isSensitive ? "private" : "upload"
  };
}

export async function deleteFromCloudinary(publicId: string, opts?: { isSensitive?: boolean }) {
  return cloudinary.uploader.destroy(publicId, {
    type: opts?.isSensitive ? "private" : "upload",
    invalidate: true
  });
}

/** Verify a Cloudinary notification webhook signature. */
export function verifyCloudinaryWebhook(body: string, signature: string, timestamp: string) {
  const expected = crypto
    .createHash("sha1")
    .update(body + timestamp + process.env.CLOUDINARY_API_SECRET)
    .digest("hex");
  return expected === signature;
}
