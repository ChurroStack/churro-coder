"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Github, Star, Download, ArrowRight } from "lucide-react";
import Image from "next/image";

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

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-16">
      {/* Radial gradient background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, #f59e0b22 0%, transparent 70%)",
        }}
      />
      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(var(--fg) 1px, transparent 1px), linear-gradient(90deg, var(--fg) 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 text-center">
        {/* Badge */}
        <motion.div
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-8 border"
          style={{
            backgroundColor: "#f59e0b18",
            borderColor: "#f59e0b40",
            color: "#f59e0b",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          {t("badge")}
        </motion.div>

        {/* Main headline */}
        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-[1.05]"
          style={{ color: "var(--fg)" }}
        >
          {t("title")}{" "}
          <span
            className="relative inline-block"
            style={{
              background: "linear-gradient(135deg, #f59e0b, #f97316)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {t("titleAccent")}
          </span>
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed"
          style={{ color: "var(--muted-fg)" }}
        >
          {t("subtitle")}
        </motion.p>

        {/* CTAs */}
        <motion.div
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <a
            href="https://github.com/ChurroStack/churro-coder/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-all duration-200 shadow-lg shadow-amber-500/20 hover:shadow-amber-400/30 hover:scale-[1.02]"
          >
            <Download className="w-4 h-4" />
            {t("ctaPrimary")}
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="https://github.com/ChurroStack/churro-coder"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-6 py-3 rounded-xl font-semibold border transition-all duration-200 hover:bg-white/10 hover:scale-[1.02]"
            style={{ borderColor: "var(--border)", color: "var(--fg)" }}
          >
            <Github className="w-4 h-4" />
            {t("ctaSecondary")}
            {stars !== null && (
              <span className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: "var(--muted)", color: "var(--muted-fg)" }}>
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                {stars.toLocaleString()}
              </span>
            )}
          </a>
        </motion.div>

        {/* Provider logos */}
        <motion.div
          custom={4}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-12 flex items-center justify-center gap-6"
        >
          <span className="text-xs font-medium" style={{ color: "var(--muted-fg)" }}>
            Works with
          </span>
          <div className="flex items-center gap-4">
            <span
              className="px-3 py-1 rounded-lg text-xs font-semibold border"
              style={{
                borderColor: "#6366f140",
                backgroundColor: "#6366f110",
                color: "#818cf8",
              }}
            >
              Claude Code
            </span>
            <span
              className="px-3 py-1 rounded-lg text-xs font-semibold border"
              style={{
                borderColor: "#22c55e40",
                backgroundColor: "#22c55e10",
                color: "#4ade80",
              }}
            >
              Codex CLI
            </span>
          </div>
        </motion.div>
      </div>

      {/* App screenshot */}
      <motion.div
        initial={{ opacity: 0, y: 48, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.5, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mt-16 w-full max-w-5xl mx-auto px-4 sm:px-6"
      >
        <div
          className="relative rounded-2xl overflow-hidden border shadow-2xl"
          style={{
            borderColor: "var(--border)",
            boxShadow: "0 40px 80px -20px rgba(0,0,0,0.5), 0 0 0 1px var(--border)",
          }}
        >
          {/* Fake title bar */}
          <div
            className="flex items-center gap-2 px-4 py-3 border-b"
            style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
          >
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-amber-500/70" />
            <span className="w-3 h-3 rounded-full bg-green-500/70" />
            <span className="ml-4 text-xs font-medium" style={{ color: "var(--muted-fg)" }}>
              Churro Coder — AI Coding Agent
            </span>
          </div>
          <div style={{ backgroundColor: "var(--card)" }}>
            <Image
              src="/images/usage.png"
              alt="Churro Coder app screenshot"
              width={1200}
              height={700}
              className="w-full object-cover object-top"
              priority
            />
          </div>
        </div>
        {/* Glow effect below screenshot */}
        <div
          className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-3/4 h-32 blur-3xl pointer-events-none"
          style={{ background: "radial-gradient(ellipse, #f59e0b18 0%, transparent 70%)" }}
        />
      </motion.div>
    </section>
  );
}
