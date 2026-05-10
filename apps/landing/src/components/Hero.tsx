"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Github, Star, Download, ArrowRight } from "lucide-react";
import Image from "next/image";
import { Lightbox } from "./Lightbox";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }),
};

export function Hero({ stars }: { stars: number | null }) {
  const t = useTranslations("hero");
  const [open, setOpen] = useState(false);

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-16 pb-24">
      {/* Background layers in their own overflow:hidden wrapper so they don't affect shadow rendering */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle, var(--border-strong) 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse 80% 60% at 50% 50%, transparent 30%, var(--bg) 90%)",
          }}
        />
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 text-center">
        {/* Badge */}
        <motion.div
          custom={0} variants={fadeUp} initial="hidden" animate="show"
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-8 border"
          style={{ borderColor: "var(--border-strong)", color: "var(--muted-fg)", backgroundColor: "var(--muted)" }}
        >
          {t("badge")}
        </motion.div>

        {/* Headline */}
        <motion.h1
          custom={1} variants={fadeUp} initial="hidden" animate="show"
          className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.05]"
          style={{ color: "var(--fg)" }}
        >
          {t("title")}{" "}
          <span style={{ color: "var(--muted-fg)" }}>{t("titleAccent")}</span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          custom={2} variants={fadeUp} initial="hidden" animate="show"
          className="text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
          style={{ color: "var(--muted-fg)" }}
        >
          {t("subtitle")}
        </motion.p>

        {/* CTAs */}
        <motion.div
          custom={3} variants={fadeUp} initial="hidden" animate="show"
          className="flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <a
            href="https://github.com/ChurroStack/churro-coder/releases"
            target="_blank" rel="noopener noreferrer"
            className="group flex items-center gap-2 px-6 py-3 rounded-xl font-semibold transition-all duration-200 hover:opacity-90 hover:scale-[1.02]"
            style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
          >
            <Download className="w-4 h-4" />
            {t("ctaPrimary")}
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="https://github.com/ChurroStack/churro-coder"
            target="_blank" rel="noopener noreferrer"
            className="group flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border transition-all duration-200 hover:scale-[1.02]"
            style={{ borderColor: "var(--border-strong)", color: "var(--fg)" }}
          >
            <Github className="w-4 h-4" />
            {t("ctaSecondary")}
            {stars !== null && (
              <span className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: "var(--muted)", color: "var(--muted-fg)" }}>
                <Star className="w-3 h-3" />
                {stars.toLocaleString()}
              </span>
            )}
          </a>
        </motion.div>

        {/* Provider chips */}
        <motion.div
          custom={4} variants={fadeUp} initial="hidden" animate="show"
          className="mt-10 flex items-center justify-center gap-4"
        >
          <span className="text-xs font-medium" style={{ color: "var(--muted-fg)" }}>{t("worksWith")}</span>
          {["Claude Code", "Codex CLI"].map((p) => (
            <span key={p} className="px-3 py-1 rounded-lg text-xs font-semibold border"
              style={{ borderColor: "var(--border-strong)", color: "var(--muted-fg)" }}>
              {p}
            </span>
          ))}
        </motion.div>
      </div>

      {/* App screenshot — shadow on wrapper so it follows rounded-rect, not PNG bounding box */}
      <motion.div
        initial={{ opacity: 0, y: 48, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.5, duration: 0.9, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        className="relative z-10 mt-16 w-full max-w-5xl mx-auto px-4 sm:px-6"
      >
        <button
          className="w-full cursor-zoom-in text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ borderRadius: 24, boxShadow: "0 20px 50px -8px rgba(0,0,0,0.28)" }}
          onClick={() => setOpen(true)}
          aria-label="Expand app screenshot"
        >
          <div className="overflow-hidden" style={{ borderRadius: 24, maxHeight: 620 }}>
            <Image
              src="/images/hero-candidate.png"
              alt="Churro Coder app screenshot"
              width={1917}
              height={1285}
              className="w-full block"
              style={{ objectPosition: "top center" }}
              priority
            />
          </div>
        </button>
      </motion.div>

      <Lightbox
        src="/images/hero-candidate.png"
        alt="Churro Coder app screenshot"
        width={1917}
        height={1285}
        open={open}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
