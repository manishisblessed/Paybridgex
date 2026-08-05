import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "NextGenPay — Payment Gateway, POS & QR Payments";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
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
            "radial-gradient(60% 80% at 20% 20%, rgba(233,69,96,0.4) 0%, rgba(233,69,96,0) 60%), radial-gradient(50% 60% at 100% 100%, rgba(212,168,67,0.3) 0%, rgba(212,168,67,0) 60%), linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
          color: "white",
          fontFamily: "system-ui, sans-serif"
        }}
      >
        {/* Top: logo lockup — bare violet mark + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <svg width="102" height="70" viewBox="0 0 32 22" fill="none">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M0.00172773 0V6.85398C0.00172773 6.85398 -0.133178 9.01207 1.98092 10.8388L13.6912 21.9964L19.7809 21.9181L18.8042 9.88248L16.4951 7.17289L9.23799 0H0.00172773Z"
              fill="#7367F0"
            />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M7.77295 16.3566L23.6563 0H32V6.88383C32 6.88383 31.8262 9.17836 30.6591 10.4057L19.7824 22H13.6938L7.77295 16.3566Z"
              fill="#7367F0"
            />
          </svg>
          <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: -1 }}>
            NextGenPay
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
            Powering Payments for a{" "}
            <span
              style={{
                background:
                  "linear-gradient(90deg, #e94560 0%, #f0d68a 100%)",
                backgroundClip: "text",
                color: "transparent"
              }}
            >
              Digital Bharat
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
            <span style={{ fontWeight: 600 }}>jmpnextgenpay.com</span>
            <span>·</span>
            <span>contact@jmpnextgenpay.com</span>
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
