import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Header } from "@/components/Header";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { colors, radii } from "@/lib/theme";

const va = {
  beneficiary: "Paybridgex Retail · Rohan Sharma",
  account: "PRISM00198754321",
  ifsc: "RATN0VAAPIS",
  bank: "RBL Bank · Virtual Account",
  upi: "rohan.paybridgex@rbl"
};

const transfers = [
  { date: "Today · 11:42", from: "Anita Kapoor", amount: 1500 },
  { date: "Today · 09:18", from: "Sunita Devi", amount: 850 },
  { date: "Yest · 18:55", from: "Karan Mehta", amount: 4200 },
  { date: "Yest · 12:30", from: "Riya Singh", amount: 320 }
];

export default function VirtualAccountScreen() {
  function shareAll() {
    Share.share({
      message: `Pay ${va.beneficiary}\nA/C: ${va.account}\nIFSC: ${va.ifsc}\nUPI: ${va.upi}`
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <Header title="Virtual Account" subtitle="Personal IFSC + account · powered by RBL" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="business" size={22} color="#fff" />
            <Text style={styles.cardBank}>{va.bank}</Text>
          </View>
          <Text style={styles.cardLabel}>Beneficiary name</Text>
          <Text style={styles.cardValue}>{va.beneficiary}</Text>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Account number</Text>
              <Text style={styles.cardValueBig}>{va.account}</Text>
            </View>
            <View style={{ width: 110 }}>
              <Text style={styles.cardLabel}>IFSC</Text>
              <Text style={styles.cardValueBig}>{va.ifsc}</Text>
            </View>
          </View>

          <View style={styles.upiRow}>
            <View>
              <Text style={styles.cardLabel}>UPI handle</Text>
              <Text style={styles.cardValue}>{va.upi}</Text>
            </View>
            <Pressable style={styles.copy}>
              <Ionicons name="copy-outline" size={18} color="#fff" />
            </Pressable>
          </View>
        </Card>

        <View style={styles.actions}>
          <Button label="Share details" icon="share-social-outline" variant="outline" onPress={shareAll} style={{ flex: 1 }} />
          <Button label="View statements" icon="document-text-outline" variant="dark" style={{ flex: 1 }} />
        </View>

        <Text style={styles.section}>Recent inward transfers</Text>
        <Card>
          {transfers.map((t, i) => (
            <View key={i} style={[styles.txn, i < transfers.length - 1 && styles.txnDivider]}>
              <View style={styles.txnIcon}>
                <Ionicons name="arrow-down" size={16} color={colors.emerald[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txnFrom}>{t.from}</Text>
                <Text style={styles.txnDate}>{t.date}</Text>
              </View>
              <Text style={styles.txnAmount}>+ ₹{t.amount.toLocaleString("en-IN")}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.brand[700], padding: 20 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  cardBank: { color: "#fff", fontWeight: "800", fontSize: 13 },
  cardLabel: { color: "rgba(255,255,255,0.75)", fontSize: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  cardValue: { color: "#fff", fontWeight: "800", fontSize: 14, marginTop: 4 },
  cardValueBig: { color: "#fff", fontWeight: "900", fontSize: 16, marginTop: 4, fontFamily: "monospace" },
  row2: { flexDirection: "row", marginTop: 14, gap: 14 },
  upiRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    padding: 12,
    borderRadius: radii.md
  },
  copy: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  actions: { flexDirection: "row", gap: 10, marginTop: 14 },
  section: { marginTop: 20, marginBottom: 10, fontWeight: "800", color: colors.ink[900], fontSize: 14 },
  txn: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  txnDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  txnIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.emerald[50], alignItems: "center", justifyContent: "center" },
  txnFrom: { fontWeight: "800", color: colors.ink[900], fontSize: 13 },
  txnDate: { fontSize: 11, color: colors.ink[500], marginTop: 2 },
  txnAmount: { fontWeight: "900", color: colors.emerald[600], fontSize: 14 }
});
