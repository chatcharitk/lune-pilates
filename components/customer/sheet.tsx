"use client";

// The customer bottom sheet: a focus-trapped, Escape-dismissable dialog that slides
// up from the bottom of the mobile frame. Shared by the cancel sheet and the booking
// rules sheet so both behave identically — focus moves in on open, Tab stays inside,
// Escape and the backdrop close it, and focus returns to whatever opened it.
//
// Children read the dialog's title id from SheetTitleContext and put it on their
// heading, so the dialog is always labelled by the text the customer actually sees.

import { createContext, useEffect, useId, useRef, useState } from "react";

export const SheetTitleContext = createContext<string>("");

export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [show, setShow] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement | null;
      setRender(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)));
      return () => cancelAnimationFrame(r);
    }
    setShow(false);
    const tm = setTimeout(() => setRender(false), 300);
    return () => clearTimeout(tm);
  }, [open]);

  useEffect(() => {
    if (!render && prevFocus.current) {
      prevFocus.current.focus?.();
      prevFocus.current = null;
    }
  }, [render]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-[200] mx-auto flex max-w-[440px] flex-col justify-end">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default transition-opacity duration-300"
        style={{
          background: "rgba(40,32,24,0.34)",
          opacity: show ? 1 : 0,
          backdropFilter: "blur(2px)",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[88%] flex-col overflow-hidden bg-surface"
        style={{
          borderRadius: "30px 30px 0 0",
          transform: show ? "translateY(0)" : "translateY(101%)",
          transition: "transform .34s cubic-bezier(.32,.72,0,1)",
          boxShadow: "0 -20px 60px rgba(40,32,24,0.25)",
        }}
      >
        <div className="flex shrink-0 justify-center pb-1 pt-3">
          <span className="h-[5px] w-10 rounded-full bg-line-strong" />
        </div>
        <div className="overflow-y-auto px-[18px] pb-[30px] pt-2">
          <SheetTitleContext.Provider value={titleId}>{children}</SheetTitleContext.Provider>
        </div>
      </div>
    </div>
  );
}
