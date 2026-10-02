/**
 * Resilient client-side helpers for the browser → Cloudinary direct upload used
 * by the onboarding document flow.
 *
 * Design goals ("nothing fails on a recoverable error"):
 *  - Automatic retries with exponential backoff + jitter for transient faults
 *    (network drops, timeouts, HTTP 408/425/429/5xx).
 *  - Per-attempt timeout via AbortController so a stalled request can't hang the
 *    UI forever — it aborts and retries.
 *  - Precise, human-readable errors: Cloudinary's `{ error: { message } }` and
 *    our own API's `{ error }` shapes are both surfaced, so the user sees the
 *    real reason instead of a generic "Upload failed".
 *  - Non-retryable failures (bad signature, invalid file, 4xx) fail fast — no
 *    pointless retry loops.
 */

export type CloudinarySignParams = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  type: string;
};

export type CloudinaryUploadResult = {
  public_id: string;
  secure_url: string;
  resource_type: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
};

/** Per-attempt network timeout. Large files on slow mobile links need headroom. */
const ATTEMPT_TIMEOUT_MS = 120_000;
/** Total attempts (1 initial + retries) for retryable failures. */
const MAX_ATTEMPTS = 4;
/** Base backoff; grows exponentially with jitter. */
const BASE_BACKOFF_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const exp = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * BASE_BACKOFF_MS;
  return Math.min(exp + jitter, 8_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Pull a human-readable message out of a failed response (Cloudinary + our API). */
export async function extractResponseError(res: Response): Promise<string> {
  try {
    const body = await res.clone().json();
    const err = body?.error;
    if (typeof err === "string") return err;
    if (err && typeof err.message === "string") return err.message;
    if (typeof body?.message === "string") return body.message;
  } catch {
    try {
      const text = (await res.clone().text()).trim();
      if (text) return text.slice(0, 200);
    } catch {
      /* ignore */
    }
  }
  return "";
}

class NonRetryableError extends Error {}

/**
 * Fetch a fresh signed upload signature from our server. Idempotent (returns new
 * params each call), so it is safe to retry on transient faults.
 */
export async function requestUploadSignature(
  token: string | null | undefined,
  type: string
): Promise<CloudinarySignParams> {
  if (!token) {
    throw new NonRetryableError(
      "Your session link is missing or expired. Please reopen your registration link."
    );
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/onboard/${token}/documents/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const params = (await res.json()) as CloudinarySignParams;
        if (!params.cloudName || !params.apiKey || !params.signature) {
          throw new NonRetryableError(
            "Uploads are not configured on the server. Please contact support."
          );
        }
        return params;
      }

      const detail = await extractResponseError(res);
      const message = detail
        ? `Couldn't prepare the upload: ${detail}`
        : "Couldn't prepare the upload. Please try again.";
      if (!isRetryableStatus(res.status)) throw new NonRetryableError(message);
      lastError = new Error(message);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof NonRetryableError) throw err;
      lastError = normalizeNetworkError(err);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(backoffDelay(attempt));
  }

  throw lastError ?? new Error("Couldn't prepare the upload. Please try again.");
}

/**
 * Upload a file straight to Cloudinary using pre-signed params, retrying
 * transient faults. Returns the parsed Cloudinary asset metadata.
 */
export async function uploadToCloudinaryDirect(
  params: CloudinarySignParams,
  file: File
): Promise<CloudinaryUploadResult> {
  const url = `https://api.cloudinary.com/v1_1/${params.cloudName}/auto/upload`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", params.apiKey);
      formData.append("timestamp", String(params.timestamp));
      formData.append("signature", params.signature);
      formData.append("folder", params.folder);
      formData.append("type", params.type);

      const res = await fetch(url, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        return (await res.json()) as CloudinaryUploadResult;
      }

      const detail = await extractResponseError(res);
      const message = detail
        ? `Upload failed: ${detail}`
        : `Upload failed (error ${res.status}). Please try again.`;
      // 4xx (bad signature, invalid file, unsupported format) won't self-heal.
      if (!isRetryableStatus(res.status)) throw new NonRetryableError(message);
      lastError = new Error(message);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof NonRetryableError) throw err;
      lastError = normalizeNetworkError(err);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(backoffDelay(attempt));
  }

  throw lastError ?? new Error("Upload failed after multiple attempts.");
}

/**
 * Persist the uploaded document's metadata to our server, retrying transient
 * faults. Safe to retry because the endpoint is idempotent on the Cloudinary
 * `publicId` (a resent save is a no-op, not a duplicate row).
 */
export async function saveDocumentMetadata(
  token: string | null | undefined,
  payload: Record<string, unknown>
): Promise<void> {
  if (!token) {
    throw new NonRetryableError(
      "Your session link is missing or expired. Please reopen your registration link."
    );
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/onboard/${token}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) return;

      const detail = await extractResponseError(res);
      const message = detail
        ? `Couldn't save document: ${detail}`
        : "Couldn't save the document. Please try again.";
      if (!isRetryableStatus(res.status)) throw new NonRetryableError(message);
      lastError = new Error(message);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof NonRetryableError) throw err;
      lastError = normalizeNetworkError(err);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(backoffDelay(attempt));
  }

  throw lastError ?? new Error("Couldn't save the document. Please try again.");
}

function normalizeNetworkError(err: unknown): Error {
  if (err instanceof DOMException && err.name === "AbortError") {
    return new Error(
      "Upload timed out. Please check your internet connection and try again."
    );
  }
  if (err instanceof TypeError) {
    return new Error(
      "Network error during upload. Please check your connection and try again."
    );
  }
  return err instanceof Error ? err : new Error("Upload failed. Please try again.");
}
