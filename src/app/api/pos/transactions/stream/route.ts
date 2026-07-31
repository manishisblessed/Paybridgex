import { requireAuth } from "@/lib/auth-server";
import { flags } from "@/lib/env";
import { resolvePosScope } from "@/lib/pos/scope";
import { buildPosFeedResponse, feedSignature } from "@/lib/pos/feed";
import { type MirrorQueryFilters } from "@/lib/pos/mirror";
import { assertServiceEnabled } from "@/lib/services/guard";
import { SERVICE_KEYS } from "@/lib/services/catalog";
import type {
  PosTransactionStatus,
  PosPaymentMode,
} from "@/lib/partners/sameday-pos.types";

export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";
// Long-lived SSE connection — never impose a function timeout on self-hosted Node.
export const maxDuration = 0;

// Server-side refresh cadence for the mirror query. This is a cheap DB read (no
// partner call), and a payload is only pushed when the change-signature differs
// — so idle clients just get heartbeats. One SSE connection replaces the old
// per-client 5s poll of the feed endpoint.
const REFRESH_MS = 4000;
const PING_MS = 15_000;

const STATUSES: PosTransactionStatus[] = ["AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED", "VOIDED"];
const MODES: PosPaymentMode[] = ["CARD", "UPI", "NFC", "CASH", "WALLET", "NETBANKING", "BHARATQR"];

/**
 * GET /api/pos/transactions/stream — Server-Sent Events feed.
 *
 * Pushes the scoped POS transaction page (identical payload to the POST feed)
 * to the browser over one persistent connection, refreshed server-side from the
 * local mirror. The dashboard subscribes with EventSource and no longer polls,
 * eliminating repeated HTTP requests while staying entirely off the partner API.
 *
 * Protocol:
 *   • `data: <PosTransactionsResponse>`  — a feed payload (only when it changed)
 *   • `event: fatal` + `data: {error}`   — terminal condition (auth / scope /
 *     bad params); the client closes on this and shows the error (no reconnect).
 *   • `: ping`                            — heartbeat to keep the connection warm.
 * Transient drops are left to EventSource's built-in auto-reconnect.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;

  let fatal: string | null = null;
  let filters: MirrorQueryFilters | null = null;
  let page = 1;
  let pageSize = 50;
  let company: string | null = null;

  try {
    const user = await requireAuth();
    await assertServiceEnabled(SERVICE_KEYS.POS, { name: "POS Terminals", userId: user.id, role: user.role });
    if (!flags.pos) throw new Error("POS service is not enabled");

    const dateFrom = new Date(q.get("date_from") ?? "");
    const dateTo = new Date(q.get("date_to") ?? "");
    if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
      throw new Error("Invalid date range");
    }

    company = q.get("company")?.trim() || null;
    const scope = await resolvePosScope(user, { company, terminalId: q.get("terminal_id") });
    if (!scope.ok) throw new Error(scope.error);

    const rawStatus = (q.get("status") ?? "").toUpperCase() as PosTransactionStatus;
    const rawMode = (q.get("payment_mode") ?? "").toUpperCase() as PosPaymentMode;
    page = Math.max(1, Number(q.get("page")) || 1);
    pageSize = Math.min(100, Math.max(1, Number(q.get("page_size")) || 50));

    filters = {
      dateFrom,
      dateTo,
      status: STATUSES.includes(rawStatus) ? rawStatus : null,
      paymentMode: MODES.includes(rawMode) ? rawMode : null,
      terminals: scope.terminals,
    };
  } catch (e) {
    fatal = e instanceof Error ? e.message : "Failed to open POS stream";
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let running = false;
      let lastSig = "";
      let dataTimer: ReturnType<typeof setInterval> | null = null;
      let pingTimer: ReturnType<typeof setInterval> | null = null;

      const safeEnqueue = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          return false;
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (dataTimer) clearInterval(dataTimer);
        if (pingTimer) clearInterval(pingTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Stop the loop as soon as the client disconnects.
      req.signal.addEventListener("abort", cleanup);

      // Terminal condition: emit one fatal event and close (client won't retry).
      if (fatal || !filters) {
        safeEnqueue(`event: fatal\ndata: ${JSON.stringify({ error: fatal ?? "Stream unavailable" })}\n\n`);
        cleanup();
        return;
      }
      const activeFilters = filters;

      const tick = async () => {
        if (closed || running) return;
        running = true;
        try {
          const payload = await buildPosFeedResponse(activeFilters, page, pageSize, company);
          const sig = feedSignature(payload);
          if (sig !== lastSig) {
            lastSig = sig;
            safeEnqueue(`data: ${JSON.stringify(payload)}\n\n`);
          }
        } catch {
          // Transient (e.g. DB blip) — keep the stream open and retry next tick.
        } finally {
          running = false;
        }
      };

      // Prime the connection immediately, then refresh on the interval.
      await tick();
      if (closed) return;
      dataTimer = setInterval(() => void tick(), REFRESH_MS);
      pingTimer = setInterval(() => safeEnqueue(`: ping\n\n`), PING_MS);
    },
    cancel() {
      /* consumer went away — start()'s abort handler performs cleanup */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
