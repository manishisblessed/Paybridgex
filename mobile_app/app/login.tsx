import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import * as LocalAuth from "expo-local-authentication";
import * as Haptics from "expo-haptics";
import { Button } from "@/components/Button";
import { Field } from "@/components/Input";
import { colors, radii } from "@/lib/theme";
import { saveSession } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("retailer@paybridgex.in");
  const [password, setPassword] = useState("Demo@1234");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setLoading(true);
    setError("");
    try {
      const data = await api.login(email, password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await saveSession({
        token: data.token,
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        phone: data.user.phone,
        role: data.user.role,
        status: data.user.status,
        walletBalance: data.user.walletBalance,
        loggedInAt: Date.now(),
      });
      router.replace("/(tabs)");
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Cannot connect to server. Check your internet connection.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function biometric() {
    try {
      const has = await LocalAuth.hasHardwareAsync();
      const enrolled = await LocalAuth.isEnrolledAsync();
      if (!has || !enrolled) return signIn();
      const r = await LocalAuth.authenticateAsync({
        promptMessage: "Sign in to Paybridgex",
        cancelLabel: "Use password",
        disableDeviceFallback: false
      });
      if (r.success) signIn();
    } catch {
      signIn();
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <LinearGradient
          colors={[colors.brand[700], colors.brand[600], colors.accent[500]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.logoBadge}>
            <Image
              source={require("../assets/logo.png")}
              style={styles.logoImg}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.brand}>Welcome back</Text>
          <Text style={styles.tagline}>
            Login to run AePS, DMT, recharges, bills & travel from your shop.
          </Text>
        </LinearGradient>

        <View style={styles.sheet}>
          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.rose[600]} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Field
            label="Email or mobile"
            icon="person-outline"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <View>
            <Field
              label="Password"
              icon="lock-closed-outline"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPwd}
            />
            <Pressable
              onPress={() => setShowPwd((s) => !s)}
              style={styles.eye}
              hitSlop={10}
            >
              <Ionicons
                name={showPwd ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={colors.ink[500]}
              />
            </Pressable>
          </View>

          <Button label={loading ? "Signing in..." : "Sign in securely"} onPress={signIn} loading={loading} />

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.or}>OR</Text>
            <View style={styles.line} />
          </View>

          <Button label="Use biometric" variant="outline" icon="finger-print-outline" onPress={biometric} />

          <View style={styles.demo}>
            <Text style={styles.demoText}>
              <Text style={{ fontWeight: "800" }}>Demo · </Text>
              retailer@paybridgex.in / Demo@1234
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingTop: 64,
    paddingBottom: 80,
    paddingHorizontal: 24,
    alignItems: "center"
  },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14
  },
  logoImg: { width: 54, height: 54 },
  brand: { fontSize: 26, fontWeight: "900", color: "#fff" },
  tagline: { marginTop: 8, color: "rgba(255,255,255,0.9)", textAlign: "center", fontSize: 13 },
  sheet: {
    marginTop: -40,
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    flex: 1
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.rose[50],
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.rose[100],
  },
  errorText: { color: colors.rose[700], fontSize: 13, flex: 1, fontWeight: "600" },
  eye: {
    position: "absolute",
    right: 14,
    top: 32
  },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 14 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { marginHorizontal: 8, color: colors.ink[400], fontSize: 11, fontWeight: "700" },
  demo: {
    marginTop: 20,
    backgroundColor: colors.ink[50],
    borderRadius: radii.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed"
  },
  demoText: { color: colors.ink[600], fontSize: 12 }
});
