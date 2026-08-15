import { useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import Svg, { Rect, G } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import { Field } from "@/components/Input";
import { Button } from "@/components/Button";
import { ResultModal } from "@/components/Result";
import { colors, radii } from "@/lib/theme";
import { api, ApiError } from "@/lib/api";

const VPA = "paybridgex@axisbank";

function makeQrCells(seed: number, size = 21) {
  const cells: boolean[][] = [];
  let s = seed;
  for (let r = 0; r < size; r++) {
    cells[r] = [];
    for (let c = 0; c < size; c++) {
      s = (s * 9301 + 49297) % 233280;
      cells[r][c] = s / 233280 > 0.5;
    }
  }
  const finder = (rr: number, cc: number) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const e = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      cells[rr + r][cc + c] = e;
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  return cells;
}

export default function UPIScreen() {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [refId, setRefId] = useState("");
  const [resultStatus, setResultStatus] = useState<"Success" | "Pending" | "Failed">("Success");
  const [resultMsg, setResultMsg] = useState("");

  const link = `upi://pay?pa=${VPA}&pn=Paybridgex${amount ? `&am=${amount}` : ""}${note ? `&tn=${encodeURIComponent(note)}` : ""}&cu=INR`;
  const cells = makeQrCells(amount.length + note.length + 7);

  async function generateRequest() {
    if (!amount) return;
    setLoading(true);
    try {
      const res = await api.post<{ refId: string; status: string }>("/api/services/upi/collect", {
        payerVpa: VPA,
        amount: Number(amount),
        note: note || "Payment request",
      });
      setRefId(res.refId);
      setResultStatus(res.status === "FAILED" ? "Failed" : "Pending");
      setResultMsg(`UPI collect request for ₹${amount} sent`);
    } catch (e) {
      setRefId("");
      setResultStatus("Failed");
      setResultMsg(e instanceof ApiError ? e.message : "Request failed. Try again.");
    } finally {
      setLoading(false);
      setShowResult(true);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <Header title="UPI Collect" subtitle={`Accept payments to ${VPA}`} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Card style={{ alignItems: "center", paddingVertical: 24 }}>
          <View style={styles.qrFrame}>
            <Svg viewBox="0 0 21 21" width={220} height={220}>
              <Rect width={21} height={21} fill="#fff" />
              <G>
                {cells.map((row, r) =>
                  row.map((on, c) =>
                    on ? <Rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill={colors.ink[900]} /> : null
                  )
                )}
              </G>
            </Svg>
          </View>
          <Text style={styles.vpa}>{VPA}</Text>
          <Text style={styles.vpaSub}>Scan with any UPI app</Text>

          <View style={styles.shareRow}>
            <Pressable
              style={styles.shareBtn}
              onPress={() => Share.share({ message: `Pay to Paybridgex: ${link}` })}
            >
              <Ionicons name="share-social-outline" size={18} color={colors.brand[700]} />
              <Text style={styles.shareText}>Share link</Text>
            </Pressable>
            <Pressable style={styles.shareBtn}>
              <Ionicons name="copy-outline" size={18} color={colors.brand[700]} />
              <Text style={styles.shareText}>Copy VPA</Text>
            </Pressable>
          </View>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <Field label="Amount (optional)" icon="cash-outline" value={amount} onChangeText={setAmount} keyboardType="number-pad" placeholder="0" />
          <Field label="Note (optional)" icon="chatbubble-outline" value={note} onChangeText={setNote} placeholder="What's it for?" />
          <Button label="Generate request" icon="qr-code-outline" onPress={generateRequest} loading={loading} style={{ marginTop: 6 }} />
        </Card>
      </ScrollView>

      <ResultModal
        visible={showResult}
        onClose={() => setShowResult(false)}
        status={resultStatus}
        title={resultStatus === "Pending" ? "Request sent" : "Request failed"}
        subtitle={resultMsg}
        amount={amount ? parseInt(amount, 10) : undefined}
        refId={refId || undefined}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  qrFrame: {
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: radii.lg,
    borderWidth: 6,
    borderColor: colors.brand[600]
  },
  vpa: { marginTop: 14, fontSize: 16, fontWeight: "900", color: colors.ink[900] },
  vpaSub: { fontSize: 11, color: colors.ink[500], marginTop: 2 },
  shareRow: { flexDirection: "row", gap: 12, marginTop: 16 },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brand[50],
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    gap: 6
  },
  shareText: { color: colors.brand[700], fontWeight: "800", fontSize: 12 }
});
