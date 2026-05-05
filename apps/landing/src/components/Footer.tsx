"use client";

import { useTranslations, useLocale } from "next-intl";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Github } from "lucide-react";

export function Footer() {
  const t = useTranslations("footer");
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // logo-mono.png is white (for dark bg); logo-mono-dark.png is black (for light bg)
  const logoSrc = mounted && resolvedTheme === "light" ? "/logo-mono.png" : "/logo-mono-dark.png";

  const companyLinks = [
    { key: "features", href: "#features" },
    { key: "workflow", href: "#workflow" },
    { key: "docs", href: "https://github.com/ChurroStack/churro-coder/wiki" },
    { key: "about", href: "https://www.churrostack.com" },
    { key: "contact", href: "mailto:info@iberant.com" },
  ] as const;

  const legalLinks = [
    { key: "privacy", href: `https://www.churrostack.com/${locale}/privacy` },
    { key: "terms", href: `https://www.churrostack.com/${locale}/terms` },
    { key: "cookies", href: `https://www.churrostack.com/${locale}/cookies` },
  ] as const;

  return (
    <footer className="border-t" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <Image src={logoSrc} alt="Churro Coder" width={26} height={26} className="rounded-md" />
              <span className="font-semibold" style={{ color: "var(--fg)" }}>Churro Coder</span>
            </div>
            <p className="text-sm leading-relaxed mb-6 max-w-xs" style={{ color: "var(--muted-fg)" }}>
              {t("tagline")}
            </p>
            <a
              href="https://github.com/ChurroStack/churro-coder"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--muted-fg)" }}
            >
              <Github className="w-4 h-4" />
              GitHub
            </a>
          </div>

          {/* Company */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "var(--fg)" }}>
              {t("company.title")}
            </h4>
            <ul className="space-y-3">
              {companyLinks.map(({ key, href }) => {
                const isExternal = href.startsWith("http");
                return (
                  <li key={key}>
                    <a
                      href={href}
                      target={isExternal ? "_blank" : undefined}
                      rel={isExternal ? "noopener noreferrer" : undefined}
                      className="text-sm transition-colors hover:opacity-100"
                      style={{ color: "var(--muted-fg)" }}
                    >
                      {t(`company.${key}`)}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "var(--fg)" }}>
              {t("legal.title")}
            </h4>
            <ul className="space-y-3">
              {legalLinks.map(({ key, href }) => (
                <li key={key}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm transition-colors"
                    style={{ color: "var(--muted-fg)" }}
                  >
                    {t(`legal.${key}`)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          className="mt-12 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-xs" style={{ color: "var(--muted-fg)" }}>{t("copyright")}</p>
          <p className="text-xs" style={{ color: "var(--muted-fg)" }}>{t("madeWith")}</p>
        </div>
      </div>
    </footer>
  );
}
