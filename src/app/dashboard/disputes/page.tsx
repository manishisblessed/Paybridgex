"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatIST } from "@/lib/utils";
import {
  LifeBuoy,
  RefreshCw,
  Send,
  AlertCircle,
  ChevronLeft,
  Clock,
  FileBarChart2,
  ArrowRight,
} from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Panel, StatusPill, EmptyState, type PillTone } from "@/components/dashboard/ui";
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
  resolvedAt: string | null;
  messageCount: number;
  createdAt: string;
};

type DisputeDetail = DisputeRow & {
  description: string;
  resolution: string | null;
  resolvedByName: string | null;
  messages: Array<{
    id: string;
    body: string;
    fromSupport: boolean;
    authorName: string;
    createdAt: string;
  }>;
};

const STATUS_TONE: Record<string, PillTone> = {
  OPEN: "brand",
  UNDER_REVIEW: "warning",
  AWAITING_USER: "violet",
  RESOLVED: "success",
  REJECTED: "danger",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  UNDER_REVIEW: "Under review",
  AWAITING_USER: "Needs your reply",
  RESOLVED: "Resolved",
  REJECTED: "Closed",
};

const CATEGORIES = [
  { id: "TRANSACTION", label: "Transaction issue" },
  { id: "WALLET", label: "Wallet / balance" },
  { id: "COMMISSION", label: "Commission" },
  { id: "SETTLEMENT", label: "Settlement" },
  { id: "KYC", label: "KYC / onboarding" },
  { id: "OTHER", label: "Other" },
];

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "detail">("list");
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reply box
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/disputes");
      const d = await res.json();
      if (res.ok) setDisputes(d.disputes ?? []);
    } catch {
      /* keep last data */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  async function openDetail(id: string) {
    setError(null);
    const res = await fetch(`/api/disputes/${id}`);
    const d = await res.json();
    if (res.ok) {
      setDetail(d.dispute);
      setView("detail");
    } else {
      setError(typeof d.error === "string" ? d.error : "Could not open the ticket");
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !reply.trim()) return;
    setReplying(true);
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
      setReplying(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={LifeBuoy}
          title="Support Tickets"
          description="Track and reply to your support tickets. To raise a new ticket, open the transaction in Reports and click “Raise ticket” — the details are filled in for you."
        />
      </Reveal>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {view === "list" && (
        <Reveal distance={16} duration={0.45}>
          {/* Raising a ticket lives in Reports — deep-link users there. */}
          <Link
            href="/dashboard/reports"
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 px-5 py-4 transition hover:border-brand-200 hover:bg-brand-50"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-brand-700 ring-1 ring-brand-100">
                <FileBarChart2 className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">Need to raise a ticket?</p>
                <p className="text-xs text-ink-500">
                  Open the transaction in Reports and click “Raise ticket” — details fill in automatically.
                </p>
              </div>
            </div>
            <span className="flex items-center gap-1 text-xs font-semibold text-brand-700">
              Go to Reports <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>

          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-ink-500">
              {loading ? "Loading…" : `${disputes.length} ticket(s)`} · Urgent tickets are answered within 4 hours,
              normal within 48 hours.
            </p>
            <Button variant="outline" onClick={fetchList} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          {disputes.length === 0 ? (
            <EmptyState
              icon={LifeBuoy}
              title={loading ? undefined : "No tickets yet"}
              message={
                loading ? "Loading…" : "Go to Reports and raise one from a transaction if something went wrong."
              }
            />
          ) : (
            <Panel flush className="overflow-hidden">
              <ul className="divide-y divide-ink-100">
                {disputes.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => openDetail(d.id)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-brand-50/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-ink-500">{d.ticketNo}</span>
                          <StatusPill status={d.status} tone={STATUS_TONE[d.status]}>
                            {STATUS_LABELS[d.status] ?? d.status}
                          </StatusPill>
                        </div>
                        <p className="mt-1 truncate text-sm font-medium text-ink-900">{d.subject}</p>
                        <p className="text-xs text-ink-500">
                          {CATEGORIES.find((c) => c.id === d.category)?.label ?? d.category}
                          {d.txnRefId && <> · {d.txnRefId}</>} · {d.messageCount} message(s)
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs text-ink-500">
                        {formatIST(d.createdAt, { dateStyle: "medium" })}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </Reveal>
      )}

      {view === "detail" && detail && (
        <Reveal distance={16} duration={0.45} className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setView("list");
              setDetail(null);
            }}
            className="flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back to tickets
          </button>

          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-ink-500">{detail.ticketNo}</span>
              <StatusPill status={detail.status} tone={STATUS_TONE[detail.status]}>
                {STATUS_LABELS[detail.status] ?? detail.status}
              </StatusPill>
              {detail.status !== "RESOLVED" && detail.status !== "REJECTED" && (
                <span className="flex items-center gap-1 text-xs text-ink-500">
                  <Clock className="h-3 w-3" />
                  Response due {formatIST(detail.slaDueAt, { dateStyle: "medium", timeStyle: "short" })}
                </span>
              )}
            </div>
            <h2 className="mt-2 font-display text-lg font-semibold text-ink-900">{detail.subject}</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{detail.description}</p>
            {detail.txnRefId && (
              <p className="mt-2 text-xs text-ink-500">
                Linked transaction: <span className="font-mono">{detail.txnRefId}</span>
              </p>
            )}
            {detail.resolution && (
              <div
                className={`mt-3 rounded-xl border p-3 text-sm ${
                  detail.status === "RESOLVED"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide">
                  {detail.status === "RESOLVED" ? "Resolution" : "Closure note"}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{detail.resolution}</p>
              </div>
            )}
          </Panel>

          <Panel>
            <p className="flex items-center gap-2 font-display text-sm font-semibold text-ink-900">
              <span className="inline-block h-4 w-1 rounded-full bg-gradient-to-b from-brand-500 to-accent-500" aria-hidden />
              Conversation
            </p>
            <ul className="mt-3 space-y-3">
              {detail.messages.length === 0 && (
                <li className="text-xs text-ink-500">No replies yet — support will respond within the SLA.</li>
              )}
              {detail.messages.map((m) => (
                <li
                  key={m.id}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    m.fromSupport
                      ? "bg-brand-50 text-ink-800"
                      : "ml-auto bg-ink-100 text-ink-800"
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-400">
                    {m.fromSupport ? "Support" : m.authorName} ·{" "}
                    {formatIST(m.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ul>

            <form onSubmit={sendReply} className="mt-4 flex gap-2">
              <Input
                placeholder={
                  detail.status === "RESOLVED" || detail.status === "REJECTED"
                    ? "Reply to reopen this ticket…"
                    : "Write a reply…"
                }
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <Button type="submit" disabled={replying || !reply.trim()}>
                <Send className="h-4 w-4" />
                {replying ? "Sending…" : "Send"}
              </Button>
            </form>
          </Panel>
        </Reveal>
      )}
    </div>
  );
}
