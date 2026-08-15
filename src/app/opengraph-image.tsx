import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Paybridgex — Payment Gateway, POS & QR Payments";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const mark = await fetch(new URL("./og-logo.png", import.meta.url)).then(
    (res) => res.arrayBuffer()
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background:
            "radial-gradient(60% 80% at 20% 20%, rgba(16,185,129,0.35) 0%, rgba(16,185,129,0) 60%), radial-gradient(50% 60% at 100% 100%, rgba(49,100,246,0.35) 0%, rgba(49,100,246,0) 60%), linear-gradient(135deg, #0b1030 0%, #131b4e 50%, #172ca6 100%)",
          color: "white",
          fontFamily: "system-ui, sans-serif"
        }}
      >
        {/* Top: official emblem + dual-tone wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark as unknown as string} alt="" width={96} height={96} />
          <div style={{ display: "flex", fontSize: 48, fontWeight: 800, letterSpacing: -1 }}>
            <span style={{ color: "#ffffff" }}>Pay</span>
            <span style={{ color: "#34d399" }}>bridgex</span>
          </div>
        </div>

        {/* Middle headline */}
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 920 }}>
          <div
            style={{
              fontSize: 80,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2
            }}
          >
            Smart Payments.{" "}
            <span
              style={{
                background:
                  "linear-gradient(90deg, #34d399 0%, #8db4ff 100%)",
                backgroundClip: "text",
                color: "transparent"
              }}
            >
              Trusted Solutions.
            </span>
          </div>
          <div
            style={{
              marginTop: 24,
              fontSize: 26,
              color: "rgba(255,255,255,0.78)",
              maxWidth: 880,
              lineHeight: 1.4
            }}
          >
            Payment gateway, POS machines, QR collections, AePS, money
            transfer, recharges and bill payments — in one dashboard.
          </div>
        </div>

        {/* Bottom strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 28,
            borderTop: "1px solid rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.7)",
            fontSize: 20
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontWeight: 600 }}>paybridgex.in</span>
            <span>·</span>
            <span>info@paybridgex.in</span>
          </div>
          <div style={{ display: "flex", gap: 18 }}>
            {["PG", "POS", "QR", "AePS", "DMT", "BBPS"].map((tag) => (
              <span
                key={tag}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  fontSize: 18,
                  fontWeight: 600
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
