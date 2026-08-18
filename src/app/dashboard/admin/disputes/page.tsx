"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Send,
  AlertCircle,
  ChevronLeft,
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Inbox,
  Flame,
  Layers,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  Panel,
  DarkPanel,
  TablePro,
  TableEmptyRow,
  TableSkeletonRows,
  StatusPill,
  SectionTitle,
  TabNav,
  type PillTone,
} from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";

type DisputeRow = {
  id: string;
  ticketNo: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  txnRefId: string | null;
  slaDueAt: string;
  slaBreachedAt: string | null;
  messageCount: number;
  createdAt: string;
  raisedBy?: { name: string; role: string; phone: string };
};

type DisputeDetail = DisputeRow & {
  description: string;
  resolution: string | null;
  resolvedByName: string | null;
  reopenCount: number;
  messages: Array<{
    id: string;
    body: string;
    fromSupport: boolean;
    authorName: string;
    createdAt: string;
  }>;
};

const STATUS_PILL: Record<string, PillTone> = {
  OPEN: "brand",
  UNDER_REVIEW: "warning",
  AWAITING_USER: "violet",
  RESOLVED: "success",
  REJECTED: "danger",
};

const PRIORITY_PILL: Record<string, PillTone> = {
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "warning",
  URGENT: "danger",
};

function SlaCell({ d }: { d: DisputeRow }) {
  if (d.status === "RESOLVED" || d.status === "REJECTED") {
    return <span className="text-xs text-ink-400">Closed</span>;
  }
  if (d.slaBreachedAt) {
    return <StatusPill status="SLA breached" tone="danger" />;
  }
  const msLeft = new Date(d.slaDueAt).getTime() - Date.now();
  const hours = Math.floor(msLeft / 3600_000);
  if (msLeft <= 0) return <StatusPill status="Overdue" tone="danger" />;
  if (hours < 4)
    return <StatusPill status={hours < 1 ? "< 1h left" : `${hours}h left`} tone="warning" />;
  return <span className="text-xs text-ink-500">{hours}h left</span>;
}

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"active" | "breached" | "all">("active");
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reply, setReply] = useState("");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const qs =
        filter === "breached" ? "?breached=true" : filter === "active" ? "" : "";
      const res = await fetch(`/api/disputes${qs}`);
      const d = await res.json();
      if (res.ok) {
        let rows: DisputeRow[] = d.disputes ?? [];
        if (filter === "active") {
          rows = rows.filter((r) => r.status !== "RESOLVED" && r.status !== "REJECTED");
        }
        setDisputes(rows);
      }
    } catch {
      /* keep last data */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  async function openDetail(id: string) {
    setError(null);
    const res = await fetch(`/api/disputes/${id}`);
    const d = await res.json();
    if (res.ok) setDetail(d.dispute);
    else setError(typeof d.error === "string" ? d.error : "Could not open the ticket");
  }

  async function act(action: "RESOLVE" | "REJECT" | "AWAIT_USER") {
    if (!detail) return;
    if ((action === "RESOLVE" || action === "REJECT") && resolution.trim().length < 5) {
      setError("Write a resolution note first (min 5 characters).");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/disputes/${detail.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "AWAIT_USER" ? { action } : { action, resolution: resolution.trim() }
        ),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : "Action failed");
        return;
      }
      setResolution("");
      await openDetail(detail.id);
      fetchList();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !reply.trim()) return;
    setBusy("reply");
    setError(null);
    try {
      const res = await fetch(`/api/disputes/${detail.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.error === "string" ? d.error : "Could not send the reply");
        return;
      }
      setReply("");
      await openDetail(detail.id);
      fetchList();
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(null);
    }
  }

  const closed = detail?.status === "RESOLVED" || detail?.status === "REJECTED";

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Admin"
          title="Disputes & Support"
          description="Support queue with SLA tracking. Breaches are auto-escalated and alerted to ops every 30 minutes."
          actions={
            <Button variant="outline" onClick={fetchList} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          }
        />
      </Reveal>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!detail ? (
        <>
          <TabNav
            tabs={[
              { key: "active", label: "Active queue", icon: Inbox },
              { key: "breached", label: "SLA breached", icon: Flame },
              { key: "all", label: "All tickets", icon: Layers },
            ]}
            active={filter}
            onChange={(k) => setFilter(k as typeof filter)}
          />

          <Reveal distance={16} duration={0.45}>
            <TablePro>
              <table>
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Raised by</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>SLA</th>
                    <th>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {disputes.length === 0 ? (
                    loading ? (
                      <TableSkeletonRows rows={5} cols={6} />
                    ) : (
                      <TableEmptyRow colSpan={6} icon={Inbox} message="Queue is clear." />
                    )
                  ) : (
                    disputes.map((d) => (
                      <tr
                        key={d.id}
                        onClick={() => openDetail(d.id)}
                        className="cursor-pointer"
                      >
                        <td>
                          <div className="font-mono text-xs text-ink-500">{d.ticketNo}</div>
                          <div className="max-w-[260px] truncate font-medium text-ink-900">{d.subject}</div>
                          <div className="text-xs text-ink-500">
                            {d.category}
                            {d.txnRefId && <> · {d.txnRefId}</>}
                          </div>
                        </td>
                        <td>
                          <div className="font-medium">{d.raisedBy?.name ?? "—"}</div>
                          <div className="text-xs text-ink-500">
                            {d.raisedBy?.role?.replace(/_/g, " ")} · {d.raisedBy?.phone}
                          </div>
                        </td>
                        <td>
                          <StatusPill status={d.priority} tone={PRIORITY_PILL[d.priority] ?? "neutral"} />
                        </td>
                        <td>
                          <StatusPill status={d.status} tone={STATUS_PILL[d.status] ?? "neutral"}>
                            {d.status.replace(/_/g, " ")}
                          </StatusPill>
                        </td>
                        <td>
                          <SlaCell d={d} />
                        </td>
                        <td className="text-xs text-ink-500">
                          {new Date(d.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TablePro>
          </Reveal>
        </>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setDetail(null)}
            className="flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back to queue
          </button>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <Panel>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-500">{detail.ticketNo}</span>
                  <StatusPill status={detail.status} tone={STATUS_PILL[detail.status] ?? "neutral"}>
                    {detail.status.replace(/_/g, " ")}
                  </StatusPill>
                  <StatusPill status={detail.priority} tone={PRIORITY_PILL[detail.priority] ?? "neutral"} />
                  {detail.slaBreachedAt && <StatusPill status="SLA breached" tone="danger" />}
                  {!closed && (
                    <span className="flex items-center gap-1 text-xs text-ink-500">
                      <Clock className="h-3 w-3" />
                      Due {new Date(detail.slaDueAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  )}
                  {detail.reopenCount > 0 && (
                    <span className="text-xs text-ink-500">Reopened ×{detail.reopenCount}</span>
                  )}
                </div>
                <h2 className="mt-2 font-display text-lg font-semibold text-ink-900">{detail.subject}</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{detail.description}</p>
                <p className="mt-2 text-xs text-ink-500">
                  Raised by <strong>{detail.raisedBy?.name}</strong> ({detail.raisedBy?.role?.replace(/_/g, " ")},{" "}
                  {detail.raisedBy?.phone})
                  {detail.txnRefId && (
                    <>
                      {" "}· Transaction <span className="font-mono">{detail.txnRefId}</span>
                    </>
                  )}
                </p>
                {detail.resolution && (
                  <div className="mt-3 rounded-xl border border-ink-200 bg-ink-50 p-3 text-sm text-ink-800">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Resolution {detail.resolvedByName && <>— by {detail.resolvedByName}</>}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{detail.resolution}</p>
                  </div>
                )}
              </Panel>

              <Panel>
                <SectionTitle title="Conversation" />
                <ul className="mt-3 space-y-3">
                  {detail.messages.length === 0 && (
                    <li className="text-xs text-ink-500">No replies yet.</li>
                  )}
                  {detail.messages.map((m) => (
                    <li
                      key={m.id}
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                        m.fromSupport ? "ml-auto bg-brand-50 text-ink-800" : "bg-ink-100 text-ink-800"
                      }`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-400">
                        {m.authorName} ·{" "}
                        {new Date(m.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                    </li>
                  ))}
                </ul>

                <form onSubmit={sendReply} className="mt-4 flex gap-2">
                  <Input
                    placeholder="Reply as support…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <Button type="submit" disabled={busy === "reply" || !reply.trim()}>
                    <Send className="h-4 w-4" />
                    {busy === "reply" ? "Sending…" : "Send"}
                  </Button>
                </form>
              </Panel>
            </div>

            <div className="space-y-4">
              <Panel>
                <SectionTitle title="Actions" className="mb-0" />
                {closed ? (
                  <p className="mt-2 text-xs text-ink-500">
                    Ticket is closed. A user reply will reopen it automatically.
                  </p>
                ) : (
                  <>
                    <textarea
                      rows={4}
                      className="mt-3 w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                      placeholder="Resolution note (required to resolve/reject)…"
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    />
                    <div className="mt-3 grid gap-2">
                      <Button onClick={() => act("RESOLVE")} disabled={busy !== null}>
                        <CheckCircle2 className="h-4 w-4" />
                        {busy === "RESOLVE" ? "Resolving…" : "Resolve ticket"}
                      </Button>
                      <Button variant="outline" onClick={() => act("AWAIT_USER")} disabled={busy !== null}>
                        <PauseCircle className="h-4 w-4" />
                        {busy === "AWAIT_USER" ? "Updating…" : "Await user reply"}
                      </Button>
                      <Button
                        variant="outline"
                        className="border-rose-200 text-rose-700 hover:bg-rose-50"
                        onClick={() => act("REJECT")}
                        disabled={busy !== null}
                      >
                        <XCircle className="h-4 w-4" />
                        {busy === "REJECT" ? "Closing…" : "Reject / close"}
                      </Button>
                    </div>
                  </>
                )}
              </Panel>

              <DarkPanel className="text-xs text-white/70">
                <p className="font-semibold text-white">SLA policy</p>
                <p className="mt-1">Urgent 4h · High 24h · Normal 48h · Low 72h.</p>
                <p className="mt-1">
                  Breaches escalate priority one level and alert ops. &quot;Await user reply&quot; pauses the clock; it
                  restarts when the user responds.
                </p>
              </DarkPanel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
