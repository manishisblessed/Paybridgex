import type { SessionUser } from "@/lib/auth-server";
import { scopePosTerminals, resolveCompanyTerminals } from "@/lib/pos/assignments";
import { isAdminRole } from "@/lib/security/ownership";

/**
 * Ownership scoping for the POS transaction read-model, shared by the live feed
 * (POST), the SSE stream (GET) and the report export so all three enforce the
 * SAME visibility rules.
 *
 * Resolves the caller + optional company/terminal filter into a terminal scope
 * for the mirror query:
 *   • `null`               → tenant-wide (admin only, no company/terminal filter)
 *   • `[]`                 → nothing in scope (caller gets an empty feed)
 *   • `[{tid, from?, to?}]`→ these terminal windows, each clamped to the holding
 *     period so a holder sees ONLY the transactions captured while they owned
 *     the terminal (and keeps seeing them after it is unassigned). A terminal
 *     the caller held more than once appears as one entry per window.
 */
export type PosScopeResult =
  | { ok: true; terminals: { tid: string; from?: Date | null; to?: Date | null }[] | null }
  | { ok: false; status: number; error: string };

export async function resolvePosScope(
  user: SessionUser,
  opts: { company?: string | null; terminalId?: string | null }
): Promise<PosScopeResult> {
  const companyFilter = opts.company?.trim() || null;
  const terminalId = opts.terminalId?.trim() || null;

  if (companyFilter) {
    // Company filtering spans terminals across many holders → admin-only.
    if (!isAdminRole(user.role))
      return { ok: false, status: 403, error: "Company filtering is available to admins only" };
    const list = await resolveCompanyTerminals(companyFilter);
    let terminals = list.map((t) => ({ tid: t.tid, from: t.from, to: t.to }));
    if (terminalId) terminals = terminals.filter((t) => t.tid === terminalId);
    return { ok: true, terminals };
  }

  const scope = await scopePosTerminals(user);
  if (scope.all) {
    // Admin: tenant-wide, or a single terminal when one is requested.
    return { ok: true, terminals: terminalId ? [{ tid: terminalId, from: null, to: null }] : null };
  }

  if (scope.tids.length === 0)
    return { ok: false, status: 403, error: "No POS terminals are assigned to your account" };

  if (terminalId) {
    // Keep EVERY window the caller held this terminal for (it may have been
    // assigned to them more than once), not just the first match.
    const matches = scope.terminals.filter((t) => t.tid === terminalId);
    if (matches.length === 0)
      return { ok: false, status: 403, error: "You do not have access to that terminal" };
    return { ok: true, terminals: matches.map((t) => ({ tid: t.tid, from: t.from, to: t.to })) };
  }

  return { ok: true, terminals: scope.terminals.map((t) => ({ tid: t.tid, from: t.from, to: t.to })) };
}
