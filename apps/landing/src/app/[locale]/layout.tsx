import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { ThemeProvider } from "@/components/ThemeProvider";
import CookieConsent from "@/components/CookieConsent";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  const baseUrl = "https://coder.churrostack.com";
  const canonicalUrl = `${baseUrl}/${locale}`;

  return {
    title: {
      default: t("title"),
      template: `%s | Churro Coder`,
    },
    description: t("description"),
    keywords: t("keywords"),
    authors: [{ name: "ChurroStack" }],
    creator: "ChurroStack",
    publisher: "ChurroStack",
    metadataBase: new URL(baseUrl),
    alternates: {
      canonical: canonicalUrl,
      languages: {
        en: `${baseUrl}/en`,
        es: `${baseUrl}/es`,
        "x-default": `${baseUrl}/en`,
      },
    },
    openGraph: {
      type: "website",
      locale: locale === "es" ? "es_ES" : "en_US",
      alternateLocale: locale === "es" ? "en_US" : "es_ES",
      url: canonicalUrl,
      siteName: "Churro Coder",
      title: t("title"),
      description: t("description"),
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Churro Coder" }],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: ["/og-image.png"],
      creator: "@churrostack",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <div className={`${geistSans.variable} ${geistMono.variable}`}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <NextIntlClientProvider messages={messages} locale={locale}>
          {children}
          <CookieConsent
            locale={locale}
            gaId={process.env.NEXT_PUBLIC_GA_ID}
          />
        </NextIntlClientProvider>
      </ThemeProvider>
    </div>
  );
}
