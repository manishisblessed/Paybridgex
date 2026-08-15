"use client";

import { useCallback, useEffect, useState } from "react";
import { Globe, Palette, Headphones, Save, AlertCircle, CheckCircle2, Rocket } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";

type Profile = {
  brandName: string;
  tagline: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  supportEmail: string | null;
  supportPhone: string | null;
  subdomain: string | null;
  customDomain: string | null;
  status: string;
  updatedAt?: string;
};

const EMPTY: Profile = {
  brandName: "",
  tagline: "",
  logoUrl: "",
  faviconUrl: "",
  primaryColor: "#185df5",
  accentColor: "#f97606",
  supportEmail: "",
  supportPhone: "",
  subdomain: "",
  customDomain: "",
  status: "DRAFT",
};

export default function WhitelabelPage() {
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/platform/whitelabel");
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const data = await res.json();
      if (res.ok && data.profile) setProfile({ ...EMPTY, ...data.profile });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => ({ ...p, [key]: value }));
    setSaved(false);
  }

  async function save(goLive?: boolean) {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body = {
        brandName: profile.brandName.trim(),
        tagline: profile.tagline?.trim() || null,
        logoUrl: profile.logoUrl?.trim() || null,
        faviconUrl: profile.faviconUrl?.trim() || null,
        primaryColor: profile.primaryColor,
        accentColor: profile.accentColor,
        supportEmail: profile.supportEmail?.trim() || null,
        supportPhone: profile.supportPhone?.trim() || null,
        subdomain: profile.subdomain?.trim().toLowerCase() || null,
        customDomain: profile.customDomain?.trim().toLowerCase() || null,
        ...(goLive ? { status: "LIVE" as const } : {}),
      };
      const res = await fetch("/api/platform/whitelabel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Check the highlighted fields and try again");
      }
      setProfile({ ...EMPTY, ...data.profile });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (forbidden) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Platform" title="White-label portal" description="Run the platform under your own brand." />
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          White-label is available to <strong>Master Distributor</strong> and <strong>Super Distributor</strong> accounts.
          Contact your upline to upgrade.
        </div>
      </div>
    );
  }

  const canSave = profile.brandName.trim().length >= 2 && !saving && !loading;
  const canGoLive = canSave && Boolean(profile.subdomain?.trim() || profile.customDomain?.trim());
  const previewHost =
    profile.customDomain?.trim() ||
    (profile.subdomain?.trim() ? `${profile.subdomain.trim()}.paybridgex.in` : "your-brand.paybridgex.in");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform"
        title="White-label portal"
        description="Run Paybridgex under your own brand, domain and colors."
        actions={
          <div className="flex items-center gap-2">
            {profile.status === "LIVE" ? (
              <Badge variant="success">Live</Badge>
            ) : profile.status === "SUSPENDED" ? (
              <Badge variant="danger">Suspended</Badge>
            ) : (
              <Badge variant="default">Draft</Badge>
            )}
            <Button variant="secondary" onClick={() => save()} disabled={!canSave}>
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save draft"}
            </Button>
            {profile.status !== "LIVE" && (
              <Button onClick={() => save(true)} disabled={!canGoLive}>
                <Rocket className="h-4 w-4" /> Go live
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {saved && !error && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> Profile saved.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Brand identity" icon={<Palette className="h-5 w-5" />}>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <Label>Brand name *</Label>
                <Input value={profile.brandName} onChange={(e) => set("brandName", e.target.value)} placeholder="KapoorPay" />
              </div>
              <div>
                <Label>Tagline</Label>
                <Input value={profile.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} placeholder="Bharat ka apna fintech" />
              </div>
              <div>
                <Label>Primary color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={profile.primaryColor}
                    onChange={(e) => set("primaryColor", e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-lg border border-ink-200"
                  />
                  <Input value={profile.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Accent color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={profile.accentColor}
                    onChange={(e) => set("accentColor", e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded-lg border border-ink-200"
                  />
                  <Input value={profile.accentColor} onChange={(e) => set("accentColor", e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Logo URL</Label>
                <Input value={profile.logoUrl ?? ""} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://cdn.yourbrand.in/logo.svg" />
              </div>
              <div>
                <Label>Favicon URL</Label>
                <Input value={profile.faviconUrl ?? ""} onChange={(e) => set("faviconUrl", e.target.value)} placeholder="https://cdn.yourbrand.in/favicon.svg" />
              </div>
            </div>
          </Card>

          <Card title="Domain" icon={<Globe className="h-5 w-5" />}>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <Label>Subdomain</Label>
                <div className="flex items-center gap-2">
                  <Input value={profile.subdomain ?? ""} onChange={(e) => set("subdomain", e.target.value)} placeholder="kapoorpay" />
                  <span className="whitespace-nowrap text-sm text-ink-500">.paybridgex.in</span>
                </div>
              </div>
              <div>
                <Label>Custom domain</Label>
                <Input value={profile.customDomain ?? ""} onChange={(e) => set("customDomain", e.target.value)} placeholder="kapoorpay.in" />
                <p className="mt-1 text-xs text-ink-500">Point a CNAME at the platform before going live.</p>
              </div>
            </div>
          </Card>

          <Card title="Support contact" icon={<Headphones className="h-5 w-5" />}>
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <Label>Support email</Label>
                <Input value={profile.supportEmail ?? ""} onChange={(e) => set("supportEmail", e.target.value)} placeholder="hello@kapoorpay.in" />
              </div>
              <div>
                <Label>Support phone (10 digits)</Label>
                <Input value={profile.supportPhone ?? ""} onChange={(e) => set("supportPhone", e.target.value)} placeholder="9876543210" maxLength={10} />
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
            <div className="border-b border-ink-100 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-ink-500">Live preview</p>
              <p className="mt-1 text-sm font-semibold text-ink-900">{previewHost}</p>
            </div>
            <div
              className="p-6 text-white"
              style={{ background: `linear-gradient(135deg, ${profile.primaryColor}, ${profile.accentColor})` }}
            >
              <p className="text-xs font-bold uppercase tracking-widest opacity-80">{profile.brandName || "Your brand"}</p>
              <p className="mt-3 font-display text-2xl font-bold">{profile.tagline || "Your tagline here"}</p>
              <p className="mt-1 text-sm text-white/85">60+ services · Pan-India · Built on Paybridgex</p>
              <button className="mt-4 rounded-full bg-white px-4 py-1.5 text-sm font-semibold" style={{ color: profile.primaryColor }}>
                Login
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <strong>Powered by Paybridgex.</strong> Footer attribution required on all white-labels.
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>
        <h3 className="font-display text-base font-semibold text-ink-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}
