import type { Metadata } from "next";
import { Inter, Barlow_Condensed } from "next/font/google";
import AuthProvider from "@/components/AuthProvider";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getLocale } from "@/i18n/getLocale";
import { translateDict } from "@/i18n/translate.ts";
import { en } from "@/i18n/en";
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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const dict = await translateDict(en, locale);
  return {
    title: dict.metaTitle,
    description: dict.metaDesc,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const dict = await translateDict(en, locale);

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${barlowCondensed.variable}`}
    >
      <body className="min-h-dvh bg-background text-foreground">
        <AuthProvider>
          <I18nProvider locale={locale} dict={dict}>
            {children}
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
