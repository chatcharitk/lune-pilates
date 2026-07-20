import Link from "next/link";
import { BrandLogo } from "@/components/brand";

// Branded 404 (audit: stock Next 404 was served). Static bilingual copy — the
// not-found boundary renders outside the customer/admin language providers.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cream px-6 text-center">
      <BrandLogo
        imgHeight={72}
        fallback={
          <span className="font-brand text-4xl font-semibold text-taupe-deep">
            LUN<span className="lune-spark">E</span>
          </span>
        }
      />
      <h1 className="font-head text-xl font-semibold text-ink">ไม่พบหน้านี้</h1>
      <p className="max-w-sm font-body text-sm text-muted">
        หน้าที่คุณกำลังหาไม่มีอยู่ หรืออาจถูกย้ายไปแล้ว
        <br />
        This page doesn&rsquo;t exist or may have moved.
      </p>
      <Link
        href="/home"
        className="mt-2 inline-flex h-11 items-center rounded-xl bg-ink px-6 font-body text-sm font-semibold text-cream"
      >
        กลับหน้าแรก · Go home
      </Link>
    </main>
  );
}
