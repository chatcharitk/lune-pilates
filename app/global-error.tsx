"use client";

// Last-resort boundary: replaces the ROOT layout when even it throws, so it must
// render its own <html>/<body> and use only inline styles (no globals.css here).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          background: "#F1E9E0",
          color: "#2E2820",
          fontFamily: "'Hanken Grotesk', 'IBM Plex Sans Thai', sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div style={{ fontSize: 34, letterSpacing: 4, color: "#6E5E49", fontWeight: 600 }}>LUNE</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>ขออภัย มีบางอย่างผิดพลาด</div>
        <div style={{ fontSize: 14, color: "#9C8C77", maxWidth: 340 }}>
          ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง
          <br />
          Something went wrong — please try again.
          {error.digest ? <div style={{ fontSize: 11, opacity: 0.6 }}>ref: {error.digest}</div> : null}
        </div>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 8,
            height: 44,
            padding: "0 24px",
            borderRadius: 12,
            border: "none",
            background: "#2E2820",
            color: "#F1E9E0",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ลองใหม่ · Try again
        </button>
      </body>
    </html>
  );
}
