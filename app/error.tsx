"use client";

// Route-level error boundary (audit: a transient DB/network failure previously
// surfaced Next's unbranded English-only "Application error" page). Renders a
// calm, bilingual, brand-toned recovery screen inside the root layout (globals
// available). Static TH+EN copy — boundaries must not depend on providers.

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cream px-6 text-center">
      <span className="font-brand text-4xl font-semibold text-taupe-deep">
        LUN<span className="lune-spark">E</span>
      </span>
      <h1 className="font-head text-xl font-semibold text-ink">
        ขออภัย มีบางอย่างผิดพลาด
      </h1>
      <p className="max-w-sm font-body text-sm text-muted">
        ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง
        <br />
        Something went wrong — please try again.
        {error.digest && (
          <>
            <br />
            <span className="text-[11px] opacity-60">ref: {error.digest}</span>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 inline-flex h-11 items-center rounded-xl bg-ink px-6 font-body text-sm font-semibold text-cream"
      >
        ลองใหม่ · Try again
      </button>
    </main>
  );
}
