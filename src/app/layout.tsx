import type { Metadata } from "next";
import { Inter, Barlow_Condensed, Barlow, DM_Mono } from "next/font/google";
import Script from "next/script";
import AuthProvider from "@/components/AuthProvider";
import ThemeProvider from "@/components/ThemeProvider";
import VersionFooter from "@/components/VersionFooter";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
        <Script
          src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"
          strategy="afterInteractive"
        />
        <Script id="google-translate-init" strategy="afterInteractive">
          {`
            function googleTranslateElementInit() {
              new window.google.translate.TranslateElement({
                pageLanguage: 'en',
                autoDisplay: false,
              }, 'google_translate_element');
            }
            window.addEventListener('pageshow', function(e) {
              if (e.persisted) { window.location.reload(); }
            });
          `}
        </Script>
        <ThemeProvider>
          <AuthProvider>
            {children}
            <VersionFooter variant="public" />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}