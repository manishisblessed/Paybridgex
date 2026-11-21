"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/PageHeader";
import {
  Panel,
  StatTile,
  TablePro,
  TableEmptyRow,
  TableSkeletonRows,
  StatusPill,
  type PillTone,
} from "@/components/dashboard/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { formatINR, formatIST } from "@/lib/utils";
import { useStepUp } from "@/components/security/StepUpProvider";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  CreditCard,
  Lock,
  ShieldAlert,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

type Entry = {
  id: string;
  transactionRef: string;
  grossAmount: number;
  netAmount: number | null;
  txnTime: string;
  rrn: string | null;
  authCode: string | null;
  action: string;
  settlementEntryId: string | null;
  lienId: string | null;
  releaseNote: string | null;
  releasedById: string | null;
  releasedAt: string | null;
  createdAt: string;
};

type AuditEvent = {
  id: string;
  event: string;
  previousStatus: string | null;
  newStatus: string | null;
  amount: number | null;
  actorId: string | null;
  reason: string | null;
  createdAt: string;
};

type CaseDetail = {
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
  totalNetSettled: number;
  totalHeldAmount: number;
  totalLienAmount: number;
  pendingLienAmount: number;
  transactionCount: number;
  status: string;
  resolvedById: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  resolutionNote: string | null;
  createdAt: string;
  retailer: { id: string; name: string; shopName: string | null; phone: string; email?: string } | null;
  entries: Entry[];
  auditEvents: AuditEvent[];
};

const ACTION_TONE: Record<string, PillTone> = {
  HELD: "warning",
  LIENED: "danger",
  PENDING_LIEN: "warning",
  RELEASED: "success",
  REVERSED: "neutral",
};

export default function DuplicateSwipeCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const isMasterAdmin = session?.user?.role === "MASTER_ADMIN";
  const { fetchWithStepUp } = useStepUp();

  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/risk/duplicate-swipes/${id}`);
      if (res.ok) setDetail(await res.json());
      else toast.error("Failed to load case");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const handleReleaseEntry = async (entryId: string) => {
    const note = prompt("Release note (required):");
    if (!note?.trim()) return;
    setActing(true);
    try {
      const res = await fetchWithStepUp(`/api/admin/risk/duplicate-swipes/${id}/entries`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, action: "release", note: note.trim() }),
      });
      if (res.ok) {
        toast.success("Entry released");
        fetchDetail();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Release failed");
      }
    } finally {
      setActing(false);
    }
  };

  const handleBulkAction = async (action: "release_all" | "close") => {
    const resolution = prompt("Resolution type (e.g. 'confirmed_duplicate', 'false_positive', 'merchant_error'):");
    if (!resolution?.trim()) return;
    const note = prompt("Resolution note (required):");
    if (!note?.trim()) return;
    setActing(true);
    try {
      const res = await fetchWithStepUp(`/api/admin/risk/duplicate-swipes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, resolution: resolution.trim(), note: note.trim() }),
      });
      if (res.ok) {
        toast.success(action === "release_all" ? "All entries released" : "Case closed");
        fetchDetail();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Action failed");
      }
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loading..." />
        <Panel><TableSkeletonRows cols={8} rows={5} /></Panel>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case Not Found" />
        <Panel><p className="text-muted-foreground">The requested risk case could not be found.</p></Panel>
      </div>
    );
  }

  const isOpen = detail.status === "OPEN";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={() => router.push("/dashboard/admin/duplicate-swipes")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <PageHeader
          title={`Case ${detail.id.slice(0, 8)}...`}
          description={`Terminal ${detail.terminalId} · ${detail.businessDate}`}
        />
        <StatusPill status={detail.status} className="ml-auto">
          {detail.status}
        </StatusPill>
      </div>

      {/* Case summary cards */}
      <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StaggerItem>
          <StatTile icon={CreditCard} label="Gross Amount" value={formatINR(detail.totalGrossAmount)} tone="sky" />
        </StaggerItem>
        <StaggerItem>
          <StatTile icon={Lock} label="Held" value={formatINR(detail.totalHeldAmount)} tone="amber" />
        </StaggerItem>
        <StaggerItem>
          <StatTile icon={ShieldAlert} label="Liened" value={formatINR(detail.totalLienAmount)} tone="rose" />
        </StaggerItem>
        <StaggerItem>
          <StatTile icon={AlertTriangle} label="Pending Lien" value={formatINR(detail.pendingLienAmount)} tone="amber" />
        </StaggerItem>
      </Stagger>

      {/* Case info */}
      <Reveal>
        <Panel>
          <h3 className="font-semibold mb-3">Case Details</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Card</span>
              <p className="font-mono">{detail.maskedPan ?? "N/A"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Brand / Type</span>
              <p>{[detail.cardBrand, detail.cardType].filter(Boolean).join(" / ") || "N/A"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Issuing Bank</span>
              <p>{detail.issuingBank ?? "N/A"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">MID</span>
              <p className="font-mono">{detail.mid ?? "N/A"}</p>
            </div>
            {detail.retailer && (
              <>
                <div>
                  <span className="text-muted-foreground">Retailer</span>
                  <p>{detail.retailer.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Shop</span>
                  <p>{detail.retailer.shopName ?? "N/A"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Phone</span>
                  <p>{detail.retailer.phone}</p>
                </div>
              </>
            )}
            <div>
              <span className="text-muted-foreground">Detected</span>
              <p>{formatIST(detail.createdAt)}</p>
            </div>
            {detail.resolution && (
              <>
                <div>
                  <span className="text-muted-foreground">Resolution</span>
                  <p>{detail.resolution}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Resolution Note</span>
                  <p>{detail.resolutionNote}</p>
                </div>
              </>
            )}
          </div>
        </Panel>
      </Reveal>

      {/* Bulk actions (Master Admin only) */}
      {isOpen && isMasterAdmin && (
        <Reveal>
          <Panel className="flex items-center gap-3">
            <span className="text-sm font-medium">Actions:</span>
            <Button size="sm" variant="outline" disabled={acting} onClick={() => handleBulkAction("release_all")}>
              <CheckCircle2 className="w-4 h-4 mr-1" /> Release All Holds & Liens
            </Button>
            <Button size="sm" variant="outline" disabled={acting} onClick={() => handleBulkAction("close")}>
              <XCircle className="w-4 h-4 mr-1" /> Close Case (Keep Liens)
            </Button>
          </Panel>
        </Reveal>
      )}

      {/* Transaction entries */}
      <Reveal>
        <Panel>
          <h3 className="font-semibold mb-3">Flagged Transactions ({detail.entries.length})</h3>
          <TablePro>
            <thead>
              <tr>
                <th>Time</th>
                <th>Reference</th>
                <th>RRN</th>
                <th>Auth Code</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Net</th>
                <th>Action</th>
                {isOpen && isMasterAdmin && <th>Release</th>}
              </tr>
            </thead>
            <tbody>
              {detail.entries.length === 0 ? (
                <TableEmptyRow colSpan={isOpen && isMasterAdmin ? 8 : 7} message="No entries" />
              ) : (
                detail.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="text-xs whitespace-nowrap">{formatIST(e.txnTime)}</td>
                    <td className="font-mono text-xs max-w-[200px] truncate" title={e.transactionRef}>
                      {e.transactionRef}
                    </td>
                    <td className="font-mono text-xs">{e.rrn ?? "-"}</td>
                    <td className="font-mono text-xs">{e.authCode ?? "-"}</td>
                    <td className="text-right font-mono text-xs">{formatINR(e.grossAmount)}</td>
                    <td className="text-right font-mono text-xs">{e.netAmount != null ? formatINR(e.netAmount) : "-"}</td>
                    <td>
                      <StatusPill status={e.action} tone={ACTION_TONE[e.action]}>{e.action}</StatusPill>
                    </td>
                    {isOpen && isMasterAdmin && (
                      <td>
                        {(e.action === "HELD" || e.action === "LIENED" || e.action === "PENDING_LIEN") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={acting}
                            onClick={() => handleReleaseEntry(e.id)}
                          >
                            Release
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </TablePro>
        </Panel>
      </Reveal>

      {/* Audit timeline */}
      <Reveal>
        <Panel>
          <h3 className="font-semibold mb-3">Audit Timeline</h3>
          {detail.auditEvents.length === 0 ? (
            <p className="text-muted-foreground text-sm">No events recorded.</p>
          ) : (
            <div className="space-y-3">
              {detail.auditEvents.map((e) => (
                <div key={e.id} className="flex items-start gap-3 text-sm border-l-2 border-muted pl-3 py-1">
                  <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="default" className="text-xs">
                        {e.event.replace(/_/g, " ")}
                      </Badge>
                      {e.newStatus && (
                        <StatusPill status={e.newStatus}>
                          {e.newStatus}
                        </StatusPill>
                      )}
                      {e.amount != null && (
                        <span className="font-mono text-xs">{formatINR(e.amount)}</span>
                      )}
                    </div>
                    {e.reason && <p className="text-muted-foreground text-xs mt-1">{e.reason}</p>}
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {formatIST(e.createdAt)}
                      {e.actorId && <span className="ml-2">by {e.actorId.slice(0, 8)}...</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </Reveal>
    </div>
  );
}
