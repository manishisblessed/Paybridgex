/**
 * Side-effect module: load a local `.env` BEFORE any app module (`@/lib/env`,
 * which freezes a parsed `env` object at import time) is evaluated. Import this
 * as the FIRST import in a standalone script so ESM evaluates it first:
 *
 *   import "./_load-env";
 *   import { prisma } from "@/lib/db";
 *
 * In production the process manager supplies the environment, so a missing
 * `.env` is ignored.
 */
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* env provided by the process manager */
}
