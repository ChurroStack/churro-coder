"use client";

import { useTranslations, useLocale } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Github } from "lucide-react";

export function Footer() {
  const t = useTranslations("footer");
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const logoSrc =
    mounted && resolvedTheme === "light" ? "/logo-mono-dark.png" : "/logo-mono.png";

  const companyLinks = [
    { key: "features", href: "#features" },
    { key: "workflow", href: "#workflow" },
    { key: "docs", href: "https://github.com/ChurroStack/churro-coder/wiki" },
    { key: "about", href: "https://www.churrostack.com" },
    { key: "careers", href: "https://www.churrostack.com" },
    { key: "contact", href: "mailto:hello@churrostack.com" },
  ] as const;

  const legalLinks = [
    { key: "privacy", href: `https://www.churrostack.com/${locale}/privacy` },
    { key: "terms", href: `https://www.churrostack.com/${locale}/terms` },
    { key: "cookies", href: `https://www.churrostack.com/${locale}/cookies` },
  ] as const;

  return (
    <footer
      className="border-t"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--bg)" }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          {/* Brand column */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <Image
                src={logoSrc}
                alt="Churro Coder"
                width={28}
                height={28}
                className="rounded-md"
              />
              <span className="font-semibold" style={{ color: "var(--fg)" }}>
                Churro Coder
              </span>
            </div>
            <p className="text-sm leading-relaxed mb-6 max-w-xs" style={{ color: "var(--muted-fg)" }}>
              {t("tagline")}
            </p>
            <a
              href="https://github.com/ChurroStack/churro-coder"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-white/10"
              style={{ borderColor: "var(--border)", color: "var(--muted-fg)" }}
            >
              <Github className="w-4 h-4" />
              GitHub
            </a>
          </div>

          {/* Company links */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest mb-4 text-amber-500">
              {t("company.title")}
            </h4>
            <ul className="space-y-3">
              {companyLinks.map(({ key, href }) => (
                <li key={key}>
                  {href.startsWith("http") || href.startsWith("mailto") ? (
                    <a
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                      className="text-sm transition-colors hover:text-amber-400"
                      style={{ color: "var(--muted-fg)" }}
                    >
                      {t(`company.${key}`)}
                    </a>
                  ) : (
                    <a
                      href={href}
                      className="text-sm transition-colors hover:text-amber-400"
                      style={{ color: "var(--muted-fg)" }}
                    >
                      {t(`company.${key}`)}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Legal links */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-widest mb-4 text-amber-500">
              {t("legal.title")}
            </h4>
            <ul className="space-y-3">
              {legalLinks.map(({ key, href }) => (
                <li key={key}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm transition-colors hover:text-amber-400"
                    style={{ color: "var(--muted-fg)" }}
                  >
                    {t(`legal.${key}`)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="mt-12 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
            {t("copyright")}
          </p>
          <p className="text-xs" style={{ color: "var(--muted-fg)" }}>
            {t("madeWith")}
          </p>
        </div>
      </div>
    </footer>
  );
}
