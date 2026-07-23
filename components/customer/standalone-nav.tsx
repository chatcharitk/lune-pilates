"use client";

// iOS home-screen (standalone) PWA fix.
//
// When LUNE is launched from the iOS home-screen icon it runs chrome-free — until
// you navigate to another page, at which point iOS opens the destination in an
// in-app Safari view WITH the address bar (it treats a normal <a>/router link
// navigation as "leaving the app", even though every route is inside the manifest
// scope "/"). The one navigation iOS reliably keeps INSIDE the standalone window is
// a same-origin scripted navigation (location.assign).
//
// So on iOS-standalone ONLY, this capture-phase handler intercepts internal
// same-origin link taps and re-issues them via location.assign, keeping the app
// full-screen. It is a deliberate trade: those navigations become full reloads
// instead of client-side transitions, but only for iOS home-screen users, and only
// to avoid the far worse address-bar pop-up.
//
// Guarded by `navigator.standalone`, an iOS-only, non-standard flag: on Android,
// desktop, a normal Safari tab, or inside the LINE in-app browser it is falsy and
// this component does nothing at all. Renders no DOM.

import { useEffect } from "react";

export function StandaloneNav() {
  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    // Only iOS home-screen installs report standalone === true here.
    if (nav.standalone !== true) return;

    function onClick(e: MouseEvent) {
      // Ignore non-primary clicks / modifier-clicks / already-handled events.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;

      // Links that should open normally (a new context / a download) — let iOS
      // route them (out-of-scope opens the in-app browser, which is correct).
      const linkTarget = anchor.getAttribute("target");
      if (linkTarget && linkTarget !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      // External origin (e.g. the LINE login link) → leave default behaviour.
      if (url.origin !== window.location.origin) return;
      // Pure in-page hash on the current page → let it scroll, no navigation.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash
      ) {
        return;
      }
      // Already here → don't trigger a needless reload.
      if (url.href === window.location.href) return;

      // Same-origin internal navigation: take it over so iOS keeps us standalone.
      // stopImmediatePropagation prevents the framework's own click handler (which
      // would do a client-side transition that iOS breaks out of) from also firing.
      e.preventDefault();
      e.stopImmediatePropagation();
      window.location.assign(url.href);
    }

    // Capture phase on the document: fires before the framework's delegated
    // click handling (which is bound on the React root, below the document).
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
