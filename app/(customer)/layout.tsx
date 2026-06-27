import { CustomerLangProvider } from "@/components/customer/customer-context";
import { BottomNav } from "@/components/customer/bottom-nav";
import { Header } from "@/components/customer/header";

// Customer surface shell (LINE LIFF, mobile). Wraps every customer screen in the
// CustomerLangProvider so the EN/TH toggle (in the shared Header) switches the
// whole app together — chrome + content — mirroring the admin AdminShell. The
// bottom nav reads its labels from the same context.
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerLangProvider>
      <div className="mx-auto flex min-h-dvh max-w-[440px] flex-col bg-cream">
        {/* Shared brand header + EN/TH toggle on the in-nav tab screens; hidden on
            the pushed booking/checkout flows (Header decides via the pathname). */}
        <Header />
        {/* clear the fixed bottom nav + the home-indicator safe area */}
        <main className="flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</main>
        <BottomNav />
      </div>
    </CustomerLangProvider>
  );
}
