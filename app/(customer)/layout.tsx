import { CustomerLangProvider } from "@/components/customer/customer-context";
import { BottomNav } from "@/components/customer/bottom-nav";
import { Header } from "@/components/customer/header";
import { LiffGate } from "@/components/customer/liff-gate";
import { resolveActiveCustomerUid } from "@/lib/auth/session";

// Customer surface shell (LINE LIFF, mobile). Wraps every customer screen in the
// CustomerLangProvider so the EN/TH toggle (in the shared Header) switches the
// whole app together — chrome + content — mirroring the admin AdminShell. The
// bottom nav reads its labels from the same context.
//
// LINE-login gate (LINE_MODE=live): when there is no valid customer session cookie,
// render the LIFF login gate instead of the app (still inside the language provider
// so its copy is bilingual). In dev / non-live mode the mock session always resolves,
// so the gate never shows and the app renders exactly as before.
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  if (process.env.LINE_MODE === "live") {
    // Resolves null when the session's customer was removed/deleted — so a stale
    // cookie shows the login gate (clean re-login) instead of crashing a page.
    const uid = await resolveActiveCustomerUid();
    if (!uid) {
      return (
        <CustomerLangProvider>
          <LiffGate liffId={process.env.LIFF_ID ?? ""} />
        </CustomerLangProvider>
      );
    }
  }

  return (
    <CustomerLangProvider>
      <div className="mx-auto flex min-h-dvh max-w-[440px] flex-col bg-cream">
        {/* Shared brand header + EN/TH toggle on the in-nav tab screens; hidden on
            the pushed booking/checkout flows (Header decides via the pathname). */}
        <Header />
        {/* clear the fixed bottom nav + the home-indicator safe area */}
        <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">{children}</main>
        <BottomNav />
      </div>
    </CustomerLangProvider>
  );
}
