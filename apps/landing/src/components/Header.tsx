"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useTranslations, useLocale } from "next-intl";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Menu, X, Sun, Moon, Github, Star, Languages } from "lucide-react";
import { cn } from "@/lib/utils";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-9 h-9" />;
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
      style={{ color: "var(--muted-fg)" }}
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

function LanguageToggle() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = () => {
    const nextLocale = locale === "en" ? "es" : "en";
    router.replace(pathname, { locale: nextLocale });
  };

  return (
    <button
      onClick={switchLocale}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
      style={{ color: "var(--muted-fg)" }}
    >
      <Languages className="w-3.5 h-3.5" />
      {t("switchLanguage")}
    </button>
  );
}

export function Header({ stars }: { stars: number | null }) {
  const t = useTranslations("nav");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // logo-mono.png is white (for dark bg); logo-mono-dark.png is black (for light bg)
  const logoSrc = mounted && resolvedTheme === "light" ? "/logo-mono.png" : "/logo-mono-dark.png";

  const navLinks = [
    { href: "#features", label: t("features") },
    { href: "#workflow", label: t("workflow") },
    { href: "#screenshots", label: t("screenshots") },
  ];

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled ? "border-b backdrop-blur-xl" : "border-b border-transparent"
      )}
      style={
        scrolled
          ? { backgroundColor: "color-mix(in srgb, var(--bg) 90%, transparent)", borderColor: "var(--border)" }
          : {}
      }
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="#" className="flex items-center gap-2.5">
            <Image
              src={logoSrc}
              alt="Churro Coder"
              width={26}
              height={26}
              className="rounded-md"
            />
            <span className="font-semibold text-sm tracking-tight" style={{ color: "var(--fg)" }}>
              Churro Coder
            </span>
          </a>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ color: "var(--muted-fg)" }}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Actions */}
          <div className="hidden md:flex items-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
            <a
              href="https://github.com/ChurroStack/churro-coder"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors"
              style={{ color: "var(--muted-fg)", borderColor: "var(--border)" }}
            >
              <Github className="w-4 h-4" />
              {stars !== null && (
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3" style={{ color: "var(--muted-fg)" }} />
                  <span className="font-semibold" style={{ color: "var(--fg)" }}>
                    {stars.toLocaleString()}
                  </span>
                </span>
              )}
            </a>
            <a
              href="https://github.com/ChurroStack/churro-coder/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors"
              style={{
                backgroundColor: "var(--btn-primary-bg)",
                color: "var(--btn-primary-fg)",
              }}
            >
              {t("download")}
            </a>
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
              aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
            >
              {mobileOpen ? (
                <X className="w-5 h-5" style={{ color: "var(--fg)" }} />
              ) : (
                <Menu className="w-5 h-5" style={{ color: "var(--fg)" }} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="md:hidden border-t px-4 py-4 space-y-1"
          style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ color: "var(--muted-fg)" }}
            >
              {link.label}
            </a>
          ))}
          <div className="pt-2 flex flex-col gap-2">
            <LanguageToggle />
            <a
              href="https://github.com/ChurroStack/churro-coder"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border"
              style={{ color: "var(--muted-fg)", borderColor: "var(--border)" }}
            >
              <Github className="w-4 h-4" />
              GitHub
              {stars !== null && (
                <span className="flex items-center gap-1 ml-auto">
                  <Star className="w-3 h-3" style={{ color: "var(--muted-fg)" }} />
                  <span className="font-semibold" style={{ color: "var(--fg)" }}>{stars.toLocaleString()}</span>
                </span>
              )}
            </a>
            <a
              href="https://github.com/ChurroStack/churro-coder/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
              style={{
                backgroundColor: "var(--btn-primary-bg)",
                color: "var(--btn-primary-fg)",
              }}
            >
              {t("download")}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
