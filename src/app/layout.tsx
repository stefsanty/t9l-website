import type { Metadata } from "next";
import { Inter, Barlow_Condensed, Barlow, DM_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { getServerSession } from "next-auth";
import AuthProvider from "@/components/AuthProvider";
import ThemeProvider from "@/components/ThemeProvider";
import VersionFooter from "@/components/VersionFooter";
import { MembershipsProvider } from "@/components/MembershipsProvider";
import GoogleTranslateLoader from "@/components/GoogleTranslateLoader";
import { authOptions } from "@/lib/auth";
import { getMembershipsForSession, type Membership } from "@/lib/memberships";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

const barlowSans = Barlow({
  variable: "--font-barlow-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "T9L | Tennozu 9-Aside League",
  description: "Mobile dashboard for the Tennozu 9-Aside League.",
};

/**
 * v1.49.0 — async layout that resolves the NextAuth session server-side
 * and threads it into `<SessionProvider>` via the `session` prop. Pre-
 * v1.49.0 the layout was synchronous and `SessionProvider` mounted with
 * no seed, forcing a post-paint `/api/auth/session` round-trip on every
 * load that re-rendered every `useSession()` consumer (Dashboard,
 * UserTeamBadge, RsvpBar, NextMatchdayBanner, GuestLoginBanner, header
 * LineLoginButton, etc.) — the user-visible "auth UI flashes in" lag.
 *
 * The JWT callback runs server-side in parallel with the page's RSC
 * data fetch (Next.js automatically parallelizes layout + page on the
 * same request), so total TTFB is unchanged. The user just sees the
 * correct auth-aware UI on first paint instead of 300ms-1s later.
 *
 * `force-dynamic` is implicit: every authenticated route already reads
 * the host header (`getLeagueIdFromRequest` in `app/page.tsx`, etc.) so
 * the app was already dynamic per-request. Adding `getServerSession`
 * here doesn't add new dynamic surface — auth was already gating
 * dynamism upstream.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);
  // v1.59.0 — fetch memberships server-side so the league switcher
  // (header chevron + account-menu entry) can render with the correct
  // visibility decision on first paint instead of flashing in after a
  // post-paint /api/me/memberships round-trip. The query is bounded by
  // the user's roster size (typically 1-3 leagues) and runs after the
  // session resolves; a misconfigured prod (no Player.userId/lineId
  // match) returns [] without throwing.
  let memberships: Membership[] = [];
  if (session) {
    memberships = await getMembershipsForSession({
      userId: session.userId ?? null,
      lineId: session.lineId || null,
      currentLeagueId: session.leagueId ?? null,
    });
  }
  return (
    <html
      lang="en"
      className={`${inter.variable} ${barlowCondensed.variable} ${barlowSans.variable} ${dmMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var s=localStorage.getItem('t9l-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.add(s||(d?'dark':'light'));})();` }} />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="T9L" />
      </head>
      <body className="min-h-dvh bg-background text-foreground">
        <style>{`
          .skiptranslate, iframe.skiptranslate, .goog-te-banner-frame { 
            display: none !important; 
            visibility: hidden !important; 
            height: 0 !important; 
            width: 0 !important; 
            border: none !important;
          }
          body { top: 0 !important; position: static !important; }
          html { height: auto !important; }
          .goog-te-gadget { display: none !important; }
          .goog-tooltip, .goog-tooltip:hover { display: none !important; }
          .goog-text-highlight { background-color: transparent !important; box-shadow: none !important; }
        `}</style>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var l=localStorage.getItem('t9l-lang');if(l==='ja'){document.cookie='googtrans=/en/ja; path=/; SameSite=Lax';}else if(l==='en'){document.cookie='googtrans=/en/en; path=/; SameSite=Lax';}else{var j=(navigator.language||'').toLowerCase().startsWith('ja');localStorage.setItem('t9l-lang',j?'ja':'en');document.cookie=j?'googtrans=/en/ja; path=/; SameSite=Lax':'googtrans=/en/en; path=/; SameSite=Lax';}}catch(e){try{var j2=(navigator.language||'').toLowerCase().startsWith('ja');document.cookie=j2?'googtrans=/en/ja; path=/; SameSite=Lax':'googtrans=/en/en; path=/; SameSite=Lax';}catch(e2){}}})();` }} />
        <div id="google_translate_element" style={{ display: 'none' }}></div>
        {/* v1.80.4 — phase 3 perf: Google Translate is gated behind a
            client-side locale check (see GoogleTranslateLoader). The
            inline boot script above already sets the `t9l-lang`
            localStorage / `googtrans` cookie; the loader reads that on
            mount and only injects the GT script for `ja` visitors. EN
            visitors (the vast majority, including PSI lab tests) skip
            the GT bundle entirely — removes el_main_css from the network
            critical path and ~118 KiB transferred / 93.5 KiB unused JS. */}
        <GoogleTranslateLoader />
        <ThemeProvider>
          <AuthProvider session={session}>
            <MembershipsProvider memberships={memberships}>
              {children}
              <VersionFooter variant="public" />
            </MembershipsProvider>
          </AuthProvider>
        </ThemeProvider>
        <Toaster
          position="top-center"
          duration={4500}
          theme="dark"
          toastOptions={{ className: 'font-display uppercase tracking-wider text-xs' }}
        />
      </body>
    </html>
  );
}