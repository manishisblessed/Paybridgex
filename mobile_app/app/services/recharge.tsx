import { useMemo, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import { Field } from "@/components/Input";
import { Button } from "@/components/Button";
import { ResultModal } from "@/components/Result";
import { colors, radii } from "@/lib/theme";
import { operators } from "@/lib/data";
import { api, ApiError } from "@/lib/api";

type RechargeType = "mobile" | "dth" | "broadband";

const meta: Record<RechargeType, { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; numberLabel: string; numberIcon: keyof typeof Ionicons.glyphMap; presets: number[] }> = {
  mobile: {
    title: "Mobile Recharge",
    subtitle: "Prepaid plans · all operators",
    icon: "phone-portrait-outline",
    numberLabel: "Mobile number",
    numberIcon: "call-outline",
    presets: [149, 199, 249, 299, 449, 666, 999, 1499]
  },
  dth: {
    title: "DTH Recharge",
    subtitle: "Top-up your TV connection",
    icon: "tv-outline",
    numberLabel: "Subscriber ID",
    numberIcon: "tv-outline",
    presets: [199, 299, 449, 599, 899, 1299]
  },
  broadband: {
    title: "Broadband Bill",
    subtitle: "Pay broadband / OTT subscriptions",
    icon: "wifi-outline",
    numberLabel: "Customer ID",
    numberIcon: "globe-outline",
    presets: [499, 699, 999, 1499, 1999, 2499]
  }
};

export default function RechargeScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const type = (params.type as RechargeType) ?? "mobile";
  const m = meta[type] ?? meta.mobile;
  const ops = useMemo(() => {
    if (type === "dth") return operators.dth;
    if (type === "broadband") return operators.broadband;
    return operators.mobile;
  }, [type]);

  const [num, setNum] = useState("");
  const [operator, setOperator] = useState(ops[0]);
  const [amount, setAmount] = useState(String(m.presets[0]));
  const [loading, setLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [refId, setRefId] = useState("");
  const [resultStatus, setResultStatus] = useState<"Success" | "Pending" | "Failed">("Success");
  const [resultMsg, setResultMsg] = useState("");

  async function submit() {
    setLoading(true);
    try {
      const res = await api.post<{ refId: string; status: string }>("/api/services/recharge", {
        number: num,
        operator,
        amount: Number(amount),
        type: type === "mobile" ? "PREPAID" : type.toUpperCase(),
      });
      setRefId(res.refId);
      setResultStatus(res.status === "FAILED" ? "Failed" : res.status === "PENDING" || res.status === "PROCESSING" || res.status === "NEEDS_REVIEW" ? "Pending" : "Success");
      setResultMsg(`${operator} · ${num || "—"}`);
    } catch (e) {
      setRefId("");
      setResultStatus("Failed");
      setResultMsg(e instanceof ApiError ? e.message : "Recharge failed. Try again.");
    } finally {
      setLoading(false);
      setShowResult(true);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <Header title={m.title} subtitle={m.subtitle} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Card>
          <Field
            label={m.numberLabel}
            icon={m.numberIcon}
            value={num}
            onChangeText={setNum}
            keyboardType={type === "mobile" ? "phone-pad" : "default"}
          />

          <Text style={styles.label}>Operator</Text>
          <View style={styles.opsGrid}>
            {ops.map((op) => {
              const active = operator === op;
              return (
                <Pressable
                  key={op}
                  onPress={() => setOperator(op)}
                  style={[styles.opChip, active && styles.opChipActive]}
                >
                  <Text style={[styles.opText, active && { color: "#fff" }]}>{op}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>Quick plans</Text>
          <View style={styles.plans}>
            {m.presets.map((p) => {
              const active = String(p) === amount;
              return (
                <Pressable
                  key={p}
                  onPress={() => setAmount(String(p))}
                  style={[styles.plan, active && styles.planActive]}
                >
                  <Text style={[styles.planAmount, active && { color: "#fff" }]}>₹{p}</Text>
                  <Text style={[styles.planSub, active && { color: "rgba(255,255,255,0.85)" }]}>
                    {p < 250 ? "28 days" : p < 500 ? "84 days" : p < 1000 ? "Annual" : "365 days"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Custom amount"
            icon="cash-outline"
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
          />

          <Button
            label={`Recharge now · ₹${amount || "0"}`}
            iconRight="arrow-forward"
            onPress={submit}
            loading={loading}
          />
        </Card>
      </ScrollView>

      <ResultModal
        visible={showResult}
        onClose={() => setShowResult(false)}
        status={resultStatus}
        title={resultStatus === "Success" ? "Recharge successful" : resultStatus === "Pending" ? "Processing" : "Recharge failed"}
        subtitle={resultMsg}
        amount={parseInt(amount, 10) || 0}
        refId={refId || undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: colors.ink[500], fontWeight: "700", letterSpacing: 1, marginBottom: 8 },
  opsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border
  },
  opChipActive: { backgroundColor: colors.brand[600], borderColor: colors.brand[600] },
  opText: { fontWeight: "700", color: colors.ink[700], fontSize: 12 },
  plans: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  plan: {
    width: "31%",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radii.md,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center"
  },
  planActive: { backgroundColor: colors.brand[600], borderColor: colors.brand[600] },
  planAmount: { fontWeight: "900", color: colors.ink[900], fontSize: 14 },
  planSub: { fontSize: 10, color: colors.ink[500], marginTop: 2 }
});
