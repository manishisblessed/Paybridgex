import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Card } from "@/components/Card";
import { colors, formatINR, radii } from "@/lib/theme";
import { clearSession, getSession, saveSession, type Session } from "@/lib/auth";
import { api } from "@/lib/api";

const ROLE_LABEL: Record<string, string> = {
  RETAILER: "Retailer",
  DISTRIBUTOR: "Distributor",
  MASTER_DISTRIBUTOR: "Master Distributor",
  SUPER_DISTRIBUTOR: "Super Distributor",
  ADMIN: "Admin",
  SUPPORT: "Support",
  MASTER_ADMIN: "Master Admin",
};

const menuItems = [
  { i: "person-circle-outline", l: "Personal info", h: "/services/virtual-account" },
  { i: "shield-checkmark-outline", l: "KYC & documents", h: "/services/virtual-account" },
  { i: "card-outline", l: "Linked bank accounts", h: "/services/virtual-account" },
  { i: "trending-up-outline", l: "My commission slabs", h: "/(tabs)/transactions" },
  { i: "cash-outline", l: "Funds request", h: "/services/wallet" },
  { i: "stats-chart-outline", l: "Reports & exports", h: "/(tabs)/transactions" },
  { i: "notifications-outline", l: "Notifications", h: "/(tabs)" },
  { i: "lock-closed-outline", l: "Security · Biometric", h: "/login" },
  { i: "help-circle-outline", l: "Help & support", h: "/(tabs)" },
  { i: "document-text-outline", l: "Legal & policies", h: "/(tabs)" }
];

export default function Profile() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [monthlyIn, setMonthlyIn] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const s = await getSession();
    if (s) {
      setSession(s);
      setWalletBalance(s.walletBalance);
    }
    try {
      const wallet = await api.getWallet();
      setWalletBalance(wallet.balance);
      setMonthlyIn(wallet.monthlyIn);
      if (s) {
        const updated = { ...s, walletBalance: wallet.balance };
        await saveSession(updated);
        setSession(updated);
      }
    } catch {
      // offline — use cached session
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const name = session?.name ?? "User";
  const roleLabel = ROLE_LABEL[session?.role ?? ""] ?? session?.role ?? "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <LinearGradient
          colors={[colors.brand[700], colors.brand[600], colors.accent[500]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </Text>
          </View>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.role}>{roleLabel}{session?.email ? ` · ${session.email}` : ""}</Text>
          <View style={styles.heroRow}>
            <View style={{ alignItems: "center", flex: 1 }}>
              <Text style={styles.heroLabel}>Wallet</Text>
              <Text style={styles.heroValue}>{formatINR(walletBalance)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={{ alignItems: "center", flex: 1 }}>
              <Text style={styles.heroLabel}>Earned · MTD</Text>
              <Text style={styles.heroValue}>{formatINR(monthlyIn)}</Text>
            </View>
          </View>
        </LinearGradient>

        <Card style={{ padding: 0, marginTop: 16 }}>
          {menuItems.map((it, i) => (
            <Pressable
              key={it.l}
              onPress={() => router.push(it.h as never)}
              style={[
                styles.row,
                i !== 0 && { borderTopWidth: 1, borderTopColor: colors.border }
              ]}
            >
              <View style={styles.rowIcon}>
                <Ionicons name={it.i as keyof typeof Ionicons.glyphMap} size={18} color={colors.ink[700]} />
              </View>
              <Text style={styles.rowLabel}>{it.l}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.ink[400]} />
            </Pressable>
          ))}
        </Card>

        <Pressable
          onPress={async () => {
            await clearSession();
            router.replace("/login");
          }}
          style={[styles.signout]}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.rose[600]} />
          <Text style={{ color: colors.rose[600], fontWeight: "800", marginLeft: 8 }}>Sign out</Text>
        </Pressable>

        <Text style={styles.foot}>Paybridgex v1.0.0 · Powered by K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radii.xl, padding: 22, alignItems: "center" },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: { color: "#fff", fontSize: 24, fontWeight: "900" },
  name: { color: "#fff", fontSize: 18, fontWeight: "900", marginTop: 12 },
  role: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 },
  heroRow: {
    flexDirection: "row",
    width: "100%",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: radii.md,
    padding: 12,
    marginTop: 16
  },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  heroValue: { color: "#fff", fontSize: 16, fontWeight: "900", marginTop: 4 },
  divider: { width: 1, backgroundColor: "rgba(255,255,255,0.25)" },

  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.ink[50],
    alignItems: "center",
    justifyContent: "center"
  },
  rowLabel: { flex: 1, color: colors.ink[900], fontWeight: "600", fontSize: 14 },

  signout: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.rose[50],
    borderRadius: radii.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.rose[100]
  },
  foot: { textAlign: "center", color: colors.ink[400], fontSize: 11, marginTop: 24 }
});
