"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LifeBuoy,
  Plus,
  RefreshCw,
  Send,
  AlertCircle,
  ChevronLeft,
  Clock,
} from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Input, Label, Select } from "@/components/ui/Input";
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
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New ticket form
  const [form, setForm] = useState({ category: "TRANSACTION", subject: "", description: "", txnRefId: "" });
  const [submitting, setSubmitting] = useState(false);

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

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: form.category,
          subject: form.subject,
          description: form.description,
          ...(form.txnRefId.trim() ? { txnRefId: form.txnRefId.trim() } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : "Could not raise the ticket — check the fields");
        return;
      }
      setForm({ category: "TRANSACTION", subject: "", description: "", txnRefId: "" });
      await fetchList();
      await openDetail(d.id);
    } catch {
      setError("Network error — try again");
    } finally {
      setSubmitting(false);
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
          description="Raise disputes about transactions, wallet, commissions or KYC — with guaranteed response times."
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
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-ink-500">
              {loading ? "Loading…" : `${disputes.length} ticket(s)`} · Urgent tickets are answered within 4 hours,
              normal within 48 hours.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={fetchList} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button onClick={() => setView("new")}>
                <Plus className="h-4 w-4" />
                New ticket
              </Button>
            </div>
          </div>

          {disputes.length === 0 ? (
            <EmptyState
              icon={LifeBuoy}
              title={loading ? undefined : "No tickets yet"}
              message={
                loading ? "Loading…" : "Raise one if something went wrong — we respond fast."
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
                        {new Date(d.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </Reveal>
      )}

      {view === "new" && (
        <Reveal distance={16} duration={0.45}>
        <form onSubmit={createTicket} className="grid gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={() => setView("list")}
            className="flex w-fit items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-800"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back to tickets
          </button>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="cat">Category</Label>
              <Select
                id="cat"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="txn">Transaction reference (optional)</Label>
              <Input
                id="txn"
                placeholder="TXN… from your transaction history"
                value={form.txnRefId}
                onChange={(e) => setForm((f) => ({ ...f, txnRefId: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              required
              minLength={5}
              maxLength={140}
              placeholder="Short summary of the problem"
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            />
          </div>

          <div>
            <Label htmlFor="desc">Describe the issue</Label>
            <textarea
              id="desc"
              required
              minLength={10}
              maxLength={4000}
              rows={5}
              className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
              placeholder="What happened, when, and the amount involved. The more detail, the faster we resolve it."
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Raising ticket…" : "Raise ticket"}
          </Button>
        </form>
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
                  Response due {new Date(detail.slaDueAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
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
                    {new Date(m.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
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
