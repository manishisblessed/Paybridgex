"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Plus,
  Trash2,
  KeyRound,
  ShieldCheck,
  Webhook,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Power,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label } from "@/components/ui/Input";
import {
  Panel,
  DarkPanel,
  SectionTitle,
  StatusPill,
  TablePro,
  TableEmptyRow,
  TableSkeletonRows,
} from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";

type Scope = { id: string; label: string };
type ApiKeyRow = {
  id: string;
  label: string;
  keyId: string;
  scopes: string[];
  ipAllowlist: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
type EndpointRow = { id: string; url: string; events: string[]; active: boolean; createdAt: string };
type DeliveryRow = {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
};
type EventDef = { id: string; label: string };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded p-1 text-ink-500 hover:bg-ink-100"
      title="Copy"
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRow[]>([]);
  const [events, setEvents] = useState<EventDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Key creation
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");
  const [keyScopes, setKeyScopes] = useState<string[]>([]);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newSecret, setNewSecret] = useState<{ keyId: string; secret: string } | null>(null);

  // Endpoint creation
  const [showEpForm, setShowEpForm] = useState(false);
  const [epUrl, setEpUrl] = useState("");
  const [epEvents, setEpEvents] = useState<string[]>([]);
  const [creatingEp, setCreatingEp] = useState(false);
  const [newEpSecret, setNewEpSecret] = useState<string | null>(null);

  // Pending destructive actions (confirmed via dialog)
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [removeEpTarget, setRemoveEpTarget] = useState<EndpointRow | null>(null);
  const [removingEp, setRemovingEp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [kRes, wRes] = await Promise.all([fetch("/api/platform/keys"), fetch("/api/platform/webhooks")]);
      if (kRes.status === 403 || wRes.status === 403) {
        setForbidden(true);
        return;
      }
      const kData = await kRes.json();
      const wData = await wRes.json();
      if (!kRes.ok) throw new Error(kData.error || "Failed to load keys");
      if (!wRes.ok) throw new Error(wData.error || "Failed to load webhooks");
      setKeys(kData.keys ?? []);
      setScopes(kData.scopes ?? []);
      setEndpoints(wData.endpoints ?? []);
      setDeliveries(wData.deliveries ?? []);
      setEvents(wData.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createKey() {
    if (keyLabel.trim().length < 3 || keyScopes.length === 0) return;
    setCreatingKey(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: keyLabel.trim(), scopes: keyScopes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to create key");
      setNewSecret({ keyId: data.key.keyId, secret: data.secret });
      setShowKeyForm(false);
      setKeyLabel("");
      setKeyScopes([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeKey(id: string) {
    setRevoking(true);
    try {
      const res = await fetch(`/api/platform/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("API key revoked");
        await load();
      } else {
        toast.error("Failed to revoke key");
      }
    } finally {
      setRevoking(false);
    }
  }

  async function createEndpoint() {
    if (!epUrl.startsWith("https://") || epEvents.length === 0) return;
    setCreatingEp(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: epUrl.trim(), events: epEvents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to add endpoint");
      setNewEpSecret(data.secret);
      setShowEpForm(false);
      setEpUrl("");
      setEpEvents([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add endpoint");
    } finally {
      setCreatingEp(false);
    }
  }

  async function toggleEndpoint(ep: EndpointRow) {
    const res = await fetch("/api/platform/webhooks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ep.id, active: !ep.active }),
    });
    if (res.ok) await load();
  }

  async function deleteEndpoint(id: string) {
    setRemovingEp(true);
    try {
      const res = await fetch(`/api/platform/webhooks?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Webhook endpoint removed");
        await load();
      } else {
        toast.error("Failed to remove endpoint");
      }
    } finally {
      setRemovingEp(false);
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Platform" title="API keys & webhooks" description="Programmatic access to the platform." />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          API keys and webhooks are available to <strong>Master Distributor</strong> and <strong>Super Distributor</strong> accounts.
          Contact your upline to upgrade.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Reveal distance={14} duration={0.4}>
        <PageHeader
          eyebrow="Platform"
          title="API keys & webhooks"
          description="Issue scoped keys for the partner API and receive signed event notifications on your servers."
          actions={
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          }
        />
      </Reveal>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* One-time secret banners */}
      {newSecret && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-semibold text-emerald-900">Key created — copy the secret now. It will never be shown again.</p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-4 py-3 font-mono text-xs text-ink-800">
            <span className="truncate">Authorization: Bearer {newSecret.keyId}.{newSecret.secret}</span>
            <CopyButton text={`${newSecret.keyId}.${newSecret.secret}`} />
          </div>
          <Button variant="secondary" className="mt-3" onClick={() => setNewSecret(null)}>Done, I saved it</Button>
        </div>
      )}
      {newEpSecret && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-semibold text-emerald-900">
            Endpoint added — save this signing secret. Verify the <code className="font-mono">X-NGP-Signature</code> header (HMAC-SHA256 of the raw body) with it.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-4 py-3 font-mono text-xs text-ink-800">
            <span className="truncate">{newEpSecret}</span>
            <CopyButton text={newEpSecret} />
          </div>
          <Button variant="secondary" className="mt-3" onClick={() => setNewEpSecret(null)}>Done, I saved it</Button>
        </div>
      )}

      <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-accent-50/40 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-display text-base font-semibold text-ink-900">How it works</h3>
            <p className="mt-1 text-sm text-ink-600">
              Authenticate with <code className="font-mono text-xs">Authorization: Bearer &lt;keyId&gt;.&lt;secret&gt;</code>.
              Secrets are hashed at rest and shown only once. Payouts created via API still pass maker-checker approval.
              Endpoints receive signed JSON with automatic retries (8 attempts, exponential backoff).
            </p>
          </div>
        </div>
      </div>

      {/* ── API keys ── */}
      <Reveal distance={16} duration={0.45}>
      <section className="space-y-3">
        <SectionTitle
          className="mb-0"
          title="API keys"
          description="Scoped credentials for the partner API."
          action={
            <Button onClick={() => setShowKeyForm((v) => !v)}>
              <Plus className="h-4 w-4" /> New key
            </Button>
          }
        />

        {showKeyForm && (
          <Panel>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Label</Label>
                <Input value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} placeholder="e.g. Production backend" />
              </div>
              <div>
                <Label>Scopes</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {scopes.map((s) => (
                    <button
                      key={s.id}
                      onClick={() =>
                        setKeyScopes((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                        keyScopes.includes(s.id)
                          ? "border-brand-600 bg-brand-50 text-brand-700"
                          : "border-ink-200 text-ink-600 hover:border-ink-300"
                      }`}
                      title={s.label}
                    >
                      {s.id}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={createKey} disabled={creatingKey || keyLabel.trim().length < 3 || keyScopes.length === 0}>
                {creatingKey ? "Creating…" : "Create key"}
              </Button>
              <Button variant="secondary" onClick={() => setShowKeyForm(false)}>Cancel</Button>
            </div>
          </Panel>
        )}

        <TablePro>
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Key ID</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 && loading && <TableSkeletonRows rows={3} cols={6} />}
              {keys.length === 0 && !loading && (
                <TableEmptyRow
                  colSpan={6}
                  icon={KeyRound}
                  message="No API keys yet. Create one to start integrating."
                />
              )}
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>
                    <div className="flex items-center gap-2 font-semibold text-ink-900">
                      <KeyRound className="h-4 w-4 text-ink-400" /> {k.label}
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2 font-mono text-xs">
                      {k.keyId}
                      <CopyButton text={k.keyId} />
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="rounded-full bg-ink-100 px-2 py-0.5 font-mono text-[10px] text-ink-600">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="text-ink-500">{fmtDate(k.lastUsedAt)}</td>
                  <td>
                    {k.revokedAt ? <StatusPill status="Revoked" tone="danger" /> : <StatusPill status="Active" />}
                  </td>
                  <td className="text-right">
                    {!k.revokedAt && (
                      <button
                        onClick={() => setRevokeTarget(k)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
                        title="Revoke"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablePro>
      </section>
      </Reveal>

      {/* ── Webhooks ── */}
      <Reveal distance={16} duration={0.45}>
      <section className="space-y-3">
        <SectionTitle
          className="mb-0"
          title="Webhook endpoints"
          description="Signed event notifications pushed to your servers."
          action={
            <Button onClick={() => setShowEpForm((v) => !v)}>
              <Plus className="h-4 w-4" /> Add endpoint
            </Button>
          }
        />

        {showEpForm && (
          <Panel>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>HTTPS URL</Label>
                <Input value={epUrl} onChange={(e) => setEpUrl(e.target.value)} placeholder="https://api.yourdomain.in/ngp/webhook" />
              </div>
              <div>
                <Label>Events</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {events.map((ev) => (
                    <button
                      key={ev.id}
                      onClick={() =>
                        setEpEvents((cur) => (cur.includes(ev.id) ? cur.filter((x) => x !== ev.id) : [...cur, ev.id]))
                      }
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                        epEvents.includes(ev.id)
                          ? "border-brand-600 bg-brand-50 text-brand-700"
                          : "border-ink-200 text-ink-600 hover:border-ink-300"
                      }`}
                      title={ev.label}
                    >
                      {ev.id}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={createEndpoint} disabled={creatingEp || !epUrl.startsWith("https://") || epEvents.length === 0}>
                {creatingEp ? "Adding…" : "Add endpoint"}
              </Button>
              <Button variant="secondary" onClick={() => setShowEpForm(false)}>Cancel</Button>
            </div>
          </Panel>
        )}

        <TablePro>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Events</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {endpoints.length === 0 && loading && <TableSkeletonRows rows={3} cols={4} />}
              {endpoints.length === 0 && !loading && (
                <TableEmptyRow
                  colSpan={4}
                  icon={Webhook}
                  message="No endpoints yet. Add one to receive txn / payout / top-up events."
                />
              )}
              {endpoints.map((ep) => (
                <tr key={ep.id}>
                  <td>
                    <div className="flex items-center gap-2 font-mono text-xs text-ink-900">
                      <Webhook className="h-4 w-4 shrink-0 text-ink-400" />
                      <span className="max-w-[320px] truncate">{ep.url}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {ep.events.map((e) => (
                        <span key={e} className="rounded-full bg-ink-100 px-2 py-0.5 font-mono text-[10px] text-ink-600">{e}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {ep.active ? <StatusPill status="Active" /> : <StatusPill status="Paused" tone="neutral" />}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => toggleEndpoint(ep)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 hover:bg-ink-100"
                        title={ep.active ? "Pause" : "Resume"}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setRemoveEpTarget(ep)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-rose-700 hover:bg-rose-50"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TablePro>

        {deliveries.length > 0 && (
          <TablePro title="Recent deliveries" dense>
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th>HTTP</th>
                  <th>Attempts</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="font-mono text-xs">{d.event}</td>
                    <td>
                      <StatusPill
                        status={d.status}
                        tone={d.status === "SUCCESS" ? "success" : d.status === "FAILED" ? "danger" : "warning"}
                      />
                      {d.lastError && d.status !== "SUCCESS" && (
                        <span className="ml-2 text-xs text-ink-400">{d.lastError.slice(0, 60)}</span>
                      )}
                    </td>
                    <td className="text-ink-500">{d.responseCode ?? "—"}</td>
                    <td className="text-ink-500">{d.attempts}</td>
                    <td className="text-ink-500">{fmtDate(d.deliveredAt ?? d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TablePro>
        )}
      </section>
      </Reveal>

      <Reveal distance={16} duration={0.45}>
      <DarkPanel className="p-6 font-mono text-xs">
        <div className="mb-2 text-white/50"># Example: check wallet balance</div>
        <div className="text-accent-300">curl {typeof window !== "undefined" ? window.location.origin : ""}/api/v1/wallet \</div>
        <div className="text-white/80">  -H &quot;Authorization: Bearer ngp_live_xxxx.your_secret&quot;</div>
        <div className="mt-3 text-white/50"># Example: create a payout (idempotent)</div>
        <div className="text-accent-300">curl -X POST {typeof window !== "undefined" ? window.location.origin : ""}/api/v1/payouts \</div>
        <div className="text-white/80">  -H &quot;Authorization: Bearer ngp_live_xxxx.your_secret&quot; \</div>
        <div className="text-white/80">  -H &quot;Idempotency-Key: order-8412-payout&quot; \</div>
        <div className="text-white/80">  -H &quot;Content-Type: application/json&quot; \</div>
        <div className="text-white/80">  -d &apos;{"{"}&quot;mode&quot;:&quot;IMPS&quot;,&quot;amount&quot;:5000,&quot;beneficiaryName&quot;:&quot;Ramesh Kumar&quot;,&quot;accountNumber&quot;:&quot;123456789012&quot;,&quot;ifsc&quot;:&quot;SBIN0001234&quot;{"}"}&apos;</div>
      </DarkPanel>
      </Reveal>

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        busy={revoking}
        title="Revoke this key?"
        description={
          revokeTarget && (
            <>
              <span className="font-semibold text-ink-900">{revokeTarget.label}</span>{" "}
              (<span className="font-mono text-xs">{revokeTarget.keyId}</span>) — integrations using
              it will stop working immediately.
            </>
          )
        }
        confirmLabel="Revoke"
        onConfirm={async () => {
          if (!revokeTarget) return;
          await revokeKey(revokeTarget.id);
          setRevokeTarget(null);
        }}
      />

      <ConfirmDialog
        open={removeEpTarget !== null}
        onClose={() => setRemoveEpTarget(null)}
        busy={removingEp}
        title="Remove this webhook endpoint?"
        description={
          removeEpTarget && (
            <>
              <span className="font-mono text-xs text-ink-900">{removeEpTarget.url}</span> will stop
              receiving events and pending deliveries will fail.
            </>
          )
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removeEpTarget) return;
          await deleteEndpoint(removeEpTarget.id);
          setRemoveEpTarget(null);
        }}
      />
    </div>
  );
}
