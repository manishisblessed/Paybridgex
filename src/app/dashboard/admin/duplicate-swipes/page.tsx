"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import {
  Panel,
  StatTile,
  FilterBar,
  TablePro,
  TableEmptyRow,
  TableSkeletonRows,
  StatusPill,
} from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { formatINR, formatIST } from "@/lib/utils";
import { RefreshCw, Search, CreditCard, ShieldAlert, Lock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

type RiskCase = {
  id: string;
  cardFingerprint: string;
  terminalId: string;
  businessDate: string;
  maskedPan: string | null;
  cardBrand: string | null;
  cardType: string | null;
  issuingBank: string | null;
  userId: string | null;
  mid: string | null;
  totalGrossAmount: number;
  totalHeldAmount: number;
  totalLienAmount: number;
  pendingLienAmount: number;
  transactionCount: number;
  status: string;
  createdAt: string;
  retailer: { id: string; name: string; shopName: string | null; phone: string } | null;
};

type Stats = {
  openCases: number;
  totalHeldAmount: number;
  totalLienAmount: number;
  pendingLienAmount: number;
  casesToday: number;
  transactionCount: number;
};

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "RELEASED", label: "Released" },
  { value: "CLOSED", label: "Closed" },
];

export default function DuplicateSwipesPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [cases, setCases] = useState<RiskCase[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const fetchCases = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status !== "all") sp.set("status", status);
      if (q.trim()) {
        if (q.startsWith("SDPOS:") || q.includes(":")) sp.set("transactionRef", q.trim());
        else sp.set("terminalId", q.trim());
      }
      const res = await fetch(`/api/admin/risk/duplicate-swipes?${sp}`);
      if (res.ok) {
        const data = await res.json();
        setCases(data.cases);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, status, q]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/risk/duplicate-swipes/stats");
      if (res.ok) setStats(await res.json());
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => { fetchCases(); }, [fetchCases]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Duplicate Card Risk"
        description="POS duplicate card swipe detection and risk hold management"
      />

      {stats && (
        <Stagger className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StaggerItem>
            <StatTile icon={ShieldAlert} label="Open Cases" value={stats.openCases} tone="rose" />
          </StaggerItem>
          <StaggerItem>
            <StatTile icon={Lock} label="Held Amount" value={formatINR(stats.totalHeldAmount)} tone="amber" />
          </StaggerItem>
          <StaggerItem>
            <StatTile icon={CreditCard} label="Lien Amount" value={formatINR(stats.totalLienAmount)} tone="rose" />
          </StaggerItem>
          <StaggerItem>
            <StatTile icon={AlertTriangle} label="Pending Lien" value={formatINR(stats.pendingLienAmount)} tone="amber" />
          </StaggerItem>
          <StaggerItem>
            <StatTile icon={ShieldAlert} label="Cases Today" value={stats.casesToday} tone="sky" />
          </StaggerItem>
          <StaggerItem>
            <StatTile icon={CreditCard} label="Flagged Txns" value={stats.transactionCount} tone="violet" />
          </StaggerItem>
        </Stagger>
      )}

      <Reveal>
        <Panel>
          <FilterBar className="mb-4">
            <div className="flex items-center gap-2 flex-1">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by TID or transaction ref..."
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                className="bg-transparent outline-none text-sm flex-1"
              />
            </div>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="text-sm bg-background border rounded px-2 py-1"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => { fetchCases(); fetchStats(); }}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </FilterBar>

          <TablePro>
            <thead>
              <tr>
                <th>Date</th>
                <th>Terminal</th>
                <th>Card</th>
                <th>Retailer</th>
                <th className="text-right">Swipes</th>
                <th className="text-right">Total</th>
                <th className="text-right">Held</th>
                <th className="text-right">Liened</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeletonRows cols={9} rows={8} />
              ) : cases.length === 0 ? (
                <TableEmptyRow colSpan={9} message="No duplicate swipe cases found" />
              ) : (
                cases.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/dashboard/admin/duplicate-swipes/${c.id}`)}
                  >
                    <td className="text-xs whitespace-nowrap">{c.businessDate}</td>
                    <td className="font-mono text-xs">{c.terminalId}</td>
                    <td className="text-xs">
                      {c.maskedPan && <span className="font-mono">{c.maskedPan}</span>}
                      {c.cardBrand && <span className="ml-1 text-muted-foreground">{c.cardBrand}</span>}
                    </td>
                    <td className="text-xs">
                      {c.retailer ? (
                        <span>{c.retailer.name}{c.retailer.shopName ? ` (${c.retailer.shopName})` : ""}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="text-right font-mono text-xs">{c.transactionCount}</td>
                    <td className="text-right font-mono text-xs">{formatINR(c.totalGrossAmount)}</td>
                    <td className="text-right font-mono text-xs">{formatINR(c.totalHeldAmount)}</td>
                    <td className="text-right font-mono text-xs">{formatINR(c.totalLienAmount)}</td>
                    <td>
                      <StatusPill status={c.status}>
                        {c.status}
                      </StatusPill>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </TablePro>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
              <span>
                Page {page} of {totalPages} ({total} cases)
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Prev
                </Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </Reveal>
    </div>
  );
}
