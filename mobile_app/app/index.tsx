import { useEffect } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { getSession, clearSession } from "@/lib/auth";
import { api } from "@/lib/api";
import { colors } from "@/lib/theme";

export default function Splash() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getSession();
      await new Promise((r) => setTimeout(r, 700));
      if (cancelled) return;

      if (!s?.token) {
        router.replace("/login");
        return;
      }

      try {
        await api.getWallet();
        router.replace("/(tabs)");
      } catch {
        await clearSession();
        router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <LinearGradient
      colors={[colors.brand[700], colors.brand[600], colors.accent[500]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.wrap}
    >
      <View style={styles.center}>
        <View style={styles.logoBadge}>
          <Image
            source={require("../assets/logo.png")}
            style={styles.logoImg}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.brand}>Paybridgex</Text>
        <Text style={styles.tagline}>Smart Payments. Trusted Solutions.</Text>
      </View>
      <Text style={styles.foot}>Powered by K.A. PAYBRIDGEX SOLUTION (OPC) PRIVATE LIMITED</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  center: { alignItems: "center" },
  logoBadge: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20
  },
  logoImg: { width: 72, height: 72 },
  brand: { fontSize: 36, fontWeight: "900", color: "#fff", letterSpacing: -1 },
  tagline: { marginTop: 8, color: "rgba(255,255,255,0.9)", fontSize: 14 },
  foot: { position: "absolute", bottom: 32, color: "rgba(255,255,255,0.7)", fontSize: 11 }
});
