import Link from "next/link";

/**
 * Dev entry / surface chooser. In production the customer app is reached via the
 * LINE LIFF entry and the admin app via its own subdomain/route; this page is a
 * convenience for local development.
 */
export default function Index() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-10 px-6">
      <div className="text-center">
        <h1 className="font-brand text-5xl font-semibold tracking-wide text-taupe-deep">
          LUN<span className="lune-spark">E</span>
        </h1>
        <p className="mt-3 font-body text-sm uppercase tracking-[0.25em] text-muted">
          Pilates · Bangkok
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link
          href="/home"
          className="rounded-2xl bg-ink px-6 py-4 text-center font-head font-semibold text-cream shadow-[var(--shadow-soft)]"
        >
          Customer app →
        </Link>
        <Link
          href="/admin/today"
          className="rounded-2xl border border-line-strong bg-surface-2 px-6 py-4 text-center font-head font-semibold text-ink"
        >
          Admin app →
        </Link>
      </div>

      <p className="text-xs text-muted">Dev surface chooser — not a production screen.</p>
    </main>
  );
}
