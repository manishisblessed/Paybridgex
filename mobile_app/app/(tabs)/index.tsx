import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ServiceTileGrid } from "@/components/ServiceTile";
import { Card } from "@/components/Card";
import { services } from "@/lib/data";
import { colors, formatINR, radii, shadows } from "@/lib/theme";
import { getSession, type Session } from "@/lib/auth";
import { api } from "@/lib/api";

type WalletData = {
  balance: number;
  monthlyIn: number;
  monthlyOut: number;
  recentTxns: Array<{
    id: string;
    direction: string;
    reason: string;
    amount: number;
    balanceAfter: number;
    note: string | null;
    createdAt: string;
  }>;
};

const TXN_ICON_MAP: Record<string, { icon: string; color: string }> = {
  CREDIT: { icon: "arrow-down-circle-outline", color: "#10b981" },
  DEBIT: { icon: "arrow-up-circle-outline", color: "#f97606" },
  SERVICE_DEBIT: { icon: "send-outline", color: "#185df5" },
  COMMISSION: { icon: "trending-up-outline", color: "#10b981" },
  FUND_CREDIT: { icon: "wallet-outline", color: "#7c3aed" },
  FUND_DEBIT: { icon: "wallet-outline", color: "#f59e0b" },
  TOPUP: { icon: "add-circle-outline", color: "#0ea5e9" },
};

function txnVisual(direction: string, reason: string) {
  return TXN_ICON_MAP[reason] ?? TXN_ICON_MAP[direction] ?? { icon: "swap-horizontal-outline", color: "#6b7280" };
}

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWallet = useCallback(async () => {
    try {
      const data = await api.getWallet();
      setWallet(data);
    } catch {
      // silently ignore — user may be offline
    }
  }, []);

  useEffect(() => {
    getSession().then((s) => {
      if (s) setSession(s);
    });
    fetchWallet();
  }, [fetchWallet]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchWallet();
    setRefreshing(false);
  }, [fetchWallet]);

  const balance = wallet?.balance ?? session?.walletBalance ?? 0;
  const name = session?.name ?? "User";

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  function formatDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    return isToday ? `Today · ${time}` : `${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ${time}`;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.topRow}>
          <View>
            <Text style={styles.greet}>{greeting},</Text>
            <Text style={styles.name}>{name.split(" ")[0]} 👋</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable style={styles.iconBtn}>
              <Ionicons name="search-outline" size={20} color={colors.ink[800]} />
            </Pressable>
            <Pressable style={styles.iconBtn}>
              <Ionicons name="notifications-outline" size={20} color={colors.ink[800]} />
              <View style={styles.dot} />
            </Pressable>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <LinearGradient
            colors={[colors.brand[700], colors.brand[600], colors.accent[500]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.wallet, shadows.glow]}
          >
            <View style={styles.walletTop}>
              <View>
                <Text style={styles.walletLabel}>Paybridgex Wallet</Text>
                <Text style={styles.walletAmt}>{formatINR(balance)}</Text>
              </View>
              <View style={styles.walletBadge}>
                <View style={styles.live} />
                <Text style={styles.liveText}>Active</Text>
              </View>
            </View>
            <View style={styles.walletActions}>
              {[
                { l: "Add money", i: "add-circle-outline", h: "/services/wallet" },
                { l: "Withdraw", i: "arrow-down-circle-outline", h: "/services/wallet?action=withdraw" },
                { l: "Send", i: "send-outline", h: "/services/dmt" },
                { l: "Scan", i: "scan-outline", h: "/services/upi" }
              ].map((a) => (
                <Pressable
                  key={a.l}
                  onPress={() => router.push(a.h as never)}
                  style={styles.walletAction}
                >
                  <Ionicons name={a.i as keyof typeof Ionicons.glyphMap} size={20} color="#fff" />
                  <Text style={styles.walletActionText}>{a.l}</Text>
                </Pressable>
              ))}
            </View>
          </LinearGradient>
        </View>

        <View style={[styles.statsRow, { paddingHorizontal: 16, marginTop: 14 }]}>
          {[
            { l: "In · this month", v: formatINR(wallet?.monthlyIn ?? 0), c: colors.emerald[600] },
            { l: "Out · this month", v: formatINR(wallet?.monthlyOut ?? 0), c: colors.brand[600] },
          ].map((s) => (
            <View key={s.l} style={styles.statTile}>
              <Text style={styles.statLabel}>{s.l}</Text>
              <Text style={[styles.statValue, { color: s.c }]}>{s.v}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Quick services</Text>
            <Pressable onPress={() => router.push("/(tabs)/services")}>
              <Text style={styles.link}>View all →</Text>
            </Pressable>
          </View>
          <ServiceTileGrid items={services.slice(0, 8)} />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Recent transactions</Text>
            <Pressable onPress={() => router.push("/(tabs)/transactions")}>
              <Text style={styles.link}>View all →</Text>
            </Pressable>
          </View>
          <Card style={{ padding: 0 }}>
            {(wallet?.recentTxns ?? []).length === 0 && (
              <View style={{ padding: 24, alignItems: "center" }}>
                <Ionicons name="receipt-outline" size={28} color={colors.ink[300]} />
                <Text style={{ color: colors.ink[400], marginTop: 8, fontSize: 13 }}>
                  No transactions yet
                </Text>
              </View>
            )}
            {(wallet?.recentTxns ?? []).slice(0, 5).map((t, i) => {
              const vis = txnVisual(t.direction, t.reason);
              return (
                <View
                  key={t.id}
                  style={[
                    styles.txnRow,
                    i !== 0 && { borderTopWidth: 1, borderTopColor: colors.border }
                  ]}
                >
                  <View style={[styles.txnIcon, { backgroundColor: vis.color + "22" }]}>
                    <Ionicons name={vis.icon as keyof typeof Ionicons.glyphMap} size={18} color={vis.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txnTitle}>{t.reason.replace(/_/g, " ")}</Text>
                    <Text style={styles.txnSub}>
                      {t.note ?? t.reason} · {formatDate(t.createdAt)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.txnAmt}>
                      {t.direction === "CREDIT" ? "+" : "-"}{formatINR(Number(t.amount))}
                    </Text>
                    <Text
                      style={[
                        styles.txnStatus,
                        { color: t.direction === "CREDIT" ? colors.emerald[700] : colors.ink[500] }
                      ]}
                    >
                      Bal: {formatINR(Number(t.balanceAfter))}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        </View>

        <View style={styles.section}>
          <LinearGradient
            colors={[colors.ink[900], colors.brand[900], colors.brand[700]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.tip}
          >
            <Ionicons name="trophy" size={22} color={colors.accent[300] as string} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.tipTitle}>Daily challenge · 6 / 10</Text>
              <Text style={styles.tipBody}>
                Run 10 AePS withdrawals before 6 PM and unlock 2× cashback tomorrow.
              </Text>
              <View style={styles.progress}>
                <View style={[styles.progressFill, { width: "60%" }]} />
              </View>
            </View>
          </LinearGradient>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  greet: { fontSize: 12, color: colors.ink[500] },
  name: { fontSize: 22, fontWeight: "900", color: colors.ink[900], marginTop: 2 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border
  },
  dot: { position: "absolute", top: 8, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.rose[500] },
  wallet: {
    borderRadius: radii.xl,
    padding: 18,
    overflow: "hidden"
  },
  walletTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  walletLabel: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  walletAmt: { color: "#fff", fontSize: 30, fontWeight: "900", marginTop: 4 },
  walletBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    gap: 6
  },
  live: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald[500] },
  liveText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  walletActions: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  walletAction: { alignItems: "center", flex: 1 },
  walletActionText: { color: "#fff", fontSize: 11, fontWeight: "700", marginTop: 4 },

  statsRow: { flexDirection: "row", gap: 10 },
  statTile: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: radii.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  statLabel: { fontSize: 10, color: colors.ink[500], fontWeight: "700", letterSpacing: 0.6 },
  statValue: { fontSize: 18, fontWeight: "900", marginTop: 6 },

  section: { paddingHorizontal: 16, marginTop: 22 },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: colors.ink[900] },
  link: { color: colors.brand[700], fontWeight: "700", fontSize: 12 },

  txnRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  txnIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  txnTitle: { fontWeight: "700", color: colors.ink[900], fontSize: 14, textTransform: "capitalize" },
  txnSub: { color: colors.ink[500], fontSize: 11, marginTop: 2 },
  txnAmt: { fontWeight: "800", color: colors.ink[900] },
  txnStatus: { marginTop: 2, fontSize: 11, fontWeight: "700" },

  tip: { borderRadius: radii.xl, padding: 16, flexDirection: "row", alignItems: "center" },
  tipTitle: { color: "#fff", fontWeight: "800", fontSize: 13 },
  tipBody: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 2 },
  progress: { marginTop: 8, height: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.accent[400] }
});
