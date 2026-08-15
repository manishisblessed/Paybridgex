import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import { Field } from "@/components/Input";
import { Button } from "@/components/Button";
import { ResultModal } from "@/components/Result";
import { colors, radii, generateRefId } from "@/lib/theme";
import { api, ApiError } from "@/lib/api";

type BillType = "electricity" | "water" | "gas" | "credit-card" | "education" | "insurance" | "broadband";

const CATEGORY_MAP: Record<BillType, string> = {
  electricity: "ELECTRICITY",
  water: "WATER",
  gas: "GAS",
  "credit-card": "CREDIT_CARD",
  education: "EDUCATION",
  insurance: "INSURANCE",
  broadband: "BROADBAND",
};

const metaMap: Record<BillType, { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; consumerLabel: string; tone: [string, string]; refPrefix: string }> = {
  electricity: {
    title: "Electricity bill",
    subtitle: "Pay any DISCOM · instantly",
    icon: "bulb-outline",
    consumerLabel: "Consumer / K-number",
    tone: ["#f59e0b", "#f97606"],
    refPrefix: "ELEC",
  },
  water: {
    title: "Water bill",
    subtitle: "Municipal water boards",
    icon: "water-outline",
    consumerLabel: "Connection number",
    tone: ["#0ea5e9", "#0284c7"],
    refPrefix: "WATR",
  },
  gas: {
    title: "Gas (LPG / Piped)",
    subtitle: "LPG booking + piped gas bills",
    icon: "flame-outline",
    consumerLabel: "Consumer / LPG ID",
    tone: ["#f97606", "#dc2626"],
    refPrefix: "GAS",
  },
  "credit-card": {
    title: "Credit card payment",
    subtitle: "Pay any bank's credit card",
    icon: "card-outline",
    consumerLabel: "Registered mobile number",
    tone: ["#185df5", "#1e40af"],
    refPrefix: "CC",
  },
  education: {
    title: "Education fees",
    subtitle: "School / college fee payments",
    icon: "school-outline",
    consumerLabel: "Roll / Student ID",
    tone: ["#7c3aed", "#9333ea"],
    refPrefix: "EDU",
  },
  insurance: {
    title: "Insurance premium",
    subtitle: "Life insurance premiums",
    icon: "shield-checkmark-outline",
    consumerLabel: "Policy number",
    tone: ["#059669", "#047857"],
    refPrefix: "INS",
  },
  broadband: {
    title: "Broadband bill",
    subtitle: "Postpaid broadband & landline",
    icon: "wifi-outline",
    consumerLabel: "Account / Customer ID",
    tone: ["#6366f1", "#1b45ea"],
    refPrefix: "BB",
  },
};

type BillerParam = { name: string; dataType: string; optional: boolean };
type Biller = { code: string; name: string; params?: BillerParam[] };
type FetchedBill = {
  customerName: string;
  amount: number;
  dueDate?: string;
  billFetchRef?: string;
  minAmount?: number;
  maxAmount?: number;
};

export default function BillsScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const type = (params.type as BillType) ?? "electricity";
  const m = metaMap[type] ?? metaMap.electricity;
  const category = CATEGORY_MAP[type] ?? "ELECTRICITY";

  const [billers, setBillers] = useState<Biller[]>([]);
  const [billerCode, setBillerCode] = useState("");
  const [loadingBillers, setLoadingBillers] = useState(true);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [fetched, setFetched] = useState<FetchedBill | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [refId, setRefId] = useState("");
  const [resultStatus, setResultStatus] = useState<"Success" | "Pending" | "Failed">("Success");
  const [resultMsg, setResultMsg] = useState("");

  const loadBillers = useCallback(async () => {
    setLoadingBillers(true);
    try {
      const res = await api.get<{ billers: Biller[] }>(`/api/services/bbps/billers?category=${category}`);
      if (Array.isArray(res.billers) && res.billers.length > 0) {
        setBillers(res.billers);
        setBillerCode(res.billers[0].code);
      }
    } catch {
      setBillers([]);
    } finally {
      setLoadingBillers(false);
    }
  }, [category]);

  useEffect(() => { loadBillers(); }, [loadBillers]);

  const biller = useMemo(() => billers.find((b) => b.code === billerCode), [billers, billerCode]);

  const fields: BillerParam[] = useMemo(() => {
    if (biller?.params && biller.params.length > 0) return biller.params;
    return [{ name: m.consumerLabel, dataType: "ALPHANUMERIC", optional: false }];
  }, [biller, m.consumerLabel]);

  function customerParams(extra?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = (paramValues[f.name] ?? "").trim();
      if (v) out[f.name] = v;
    }
    return { ...out, ...extra };
  }

  async function fetchBill() {
    setLoading(true);
    try {
      const res = await api.post<FetchedBill>("/api/services/bbps/fetch", {
        billerCode,
        category,
        customerParams: customerParams(),
        idempotencyKey: generateRefId(`${m.refPrefix}F`),
      });
      setFetched(res);
      setAmount("");
    } catch (e) {
      setFetched(null);
      setResultStatus("Failed");
      setResultMsg(e instanceof ApiError ? e.message : "Could not fetch bill");
      setShowResult(true);
    } finally {
      setLoading(false);
    }
  }

  async function pay() {
    if (!fetched) return;
    const amt = Number(amount);
    const maxAllowed = fetched.maxAmount ?? 500000;
    if (amt > maxAllowed) {
      setResultStatus("Failed");
      setResultMsg(`Amount exceeds the maximum payable limit of ₹${maxAllowed.toLocaleString("en-IN")}`);
      setShowResult(true);
      return;
    }
    setPaying(true);
    try {
      const res = await api.post<{ refId: string; status: string }>("/api/services/bbps/pay", {
        billerCode,
        category,
        customerParams: customerParams(
          fetched.billFetchRef ? { billFetchRef: fetched.billFetchRef } : undefined
        ),
        amount: Number(amount),
        idempotencyKey: generateRefId(`${m.refPrefix}P`),
      });
      setRefId(res.refId);
      setResultStatus(
        res.status === "FAILED" ? "Failed" : res.status === "PROCESSING" ? "Pending" : "Success"
      );
      setResultMsg(`${biller?.name ?? billerCode} · ${Object.values(paramValues)[0]?.slice(-4) || "—"}`);
    } catch (e) {
      setRefId("");
      setResultStatus("Failed");
      setResultMsg(e instanceof ApiError ? e.message : "Payment failed. Try again.");
    } finally {
      setPaying(false);
      setShowResult(true);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <Header title={m.title} subtitle={m.subtitle} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Card>
          <Text style={styles.label}>Biller / Operator</Text>
          {loadingBillers ? (
            <Text style={styles.loadingText}>Loading billers…</Text>
          ) : billers.length === 0 ? (
            <Pressable onPress={loadBillers} style={styles.retryChip}>
              <Text style={styles.retryText}>No billers found — tap to retry</Text>
            </Pressable>
          ) : (
            <View style={styles.opsGrid}>
              {billers.map((b) => {
                const active = billerCode === b.code;
                return (
                  <Pressable
                    key={b.code}
                    onPress={() => { setBillerCode(b.code); setParamValues({}); setFetched(null); }}
                    style={[styles.opChip, active && styles.opChipActive]}
                  >
                    <Text style={[styles.opText, active && { color: "#fff" }]}>{b.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {fields.map((f) => (
            <Field
              key={f.name}
              label={f.name}
              icon="person-outline"
              value={paramValues[f.name] ?? ""}
              onChangeText={(v) => {
                const cleaned = f.dataType === "NUMERIC" ? v.replace(/\D/g, "") : v;
                setParamValues((p) => ({ ...p, [f.name]: cleaned }));
                setFetched(null);
              }}
              keyboardType={f.dataType === "NUMERIC" ? "number-pad" : "default"}
            />
          ))}

          {!fetched ? (
            <Button label="Fetch bill" icon="search-outline" onPress={fetchBill} loading={loading} />
          ) : (
            <View style={styles.billCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.billName}>{fetched.customerName}</Text>
                <Text style={styles.billOp}>{biller?.name ?? billerCode}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.dueLabel}>Amount due</Text>
                <Text style={styles.dueAmount}>₹ {fetched.amount.toLocaleString("en-IN")}</Text>
              </View>
            </View>
          )}

          {fetched ? (
            <>
              <Field
                label="Pay amount"
                icon="cash-outline"
                value={amount}
                onChangeText={setAmount}
                keyboardType="number-pad"
              />
              <Button
                label={`Pay ₹${amount || "0"}`}
                iconRight="lock-closed-outline"
                onPress={pay}
                loading={paying}
              />
            </>
          ) : null}
        </Card>
      </ScrollView>

      <ResultModal
        visible={showResult}
        onClose={() => setShowResult(false)}
        status={resultStatus}
        title={resultStatus === "Success" ? "Bill paid successfully" : resultStatus === "Pending" ? "Processing" : "Payment failed"}
        subtitle={resultMsg}
        amount={parseInt(amount, 10) || 0}
        refId={refId || undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: colors.ink[500], fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  loadingText: { fontSize: 13, color: colors.ink[400], marginBottom: 14 },
  retryChip: { paddingVertical: 10, marginBottom: 14 },
  retryText: { fontSize: 13, color: colors.brand[600], fontWeight: "600" },
  opsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  opChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  opChipActive: { backgroundColor: colors.brand[600], borderColor: colors.brand[600] },
  opText: { fontWeight: "700", color: colors.ink[700], fontSize: 12 },
  billCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brand[50],
    borderRadius: radii.md,
    padding: 14,
    marginBottom: 12,
  },
  billName: { fontWeight: "800", color: colors.ink[900], fontSize: 14 },
  billOp: { fontSize: 11, color: colors.ink[500], marginTop: 2 },
  dueLabel: { fontSize: 10, color: colors.ink[500], fontWeight: "700" },
  dueAmount: { fontSize: 18, fontWeight: "900", color: colors.brand[700], marginTop: 2 },
});
