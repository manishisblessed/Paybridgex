"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "system-ui, sans-serif",
            padding: "2rem",
            background: "#fef2f2",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              textAlign: "center",
              background: "#fff",
              borderRadius: 16,
              padding: "2rem",
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
            }}
          >
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#111" }}>
              Something went wrong
            </h2>
            <p style={{ marginTop: 8, color: "#666", fontSize: 14 }}>
              {error.message || "An unexpected error occurred."}
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: 20,
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "#2563eb",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
