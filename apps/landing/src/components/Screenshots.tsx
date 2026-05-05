"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { cn } from "@/lib/utils";

const tabs = [
  { key: "usage", src: "/images/usage.png" },
  { key: "plan", src: "/images/plan.png" },
  { key: "code", src: "/images/code.png" },
  { key: "review", src: "/images/review.png" },
  { key: "design", src: "/images/design.png" },
] as const;

export function Screenshots() {
  const t = useTranslations("screenshots");
  const [active, setActive] = useState<(typeof tabs)[number]["key"]>("usage");

  const activeTab = tabs.find((tab) => tab.key === active)!;

  return (
    <section id="screenshots" className="py-32">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
            style={{ color: "var(--fg)" }}
          >
            {t("title")}
          </h2>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: "var(--muted-fg)" }}>
            {t("subtitle")}
          </p>
        </motion.div>

        {/* Tab selector */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex justify-center mb-8"
        >
          <div
            className="inline-flex items-center gap-1 p-1 rounded-xl border"
            style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActive(tab.key)}
                className={cn(
                  "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                  active === tab.key
                    ? "bg-amber-500 text-zinc-950 shadow-sm"
                    : "hover:bg-white/10"
                )}
                style={
                  active !== tab.key ? { color: "var(--muted-fg)" } : {}
                }
              >
                {t(tab.key)}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Screenshot display */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative"
        >
          <div
            className="rounded-2xl overflow-hidden border shadow-2xl"
            style={{
              borderColor: "var(--border)",
              boxShadow: "0 40px 80px -20px rgba(0,0,0,0.4), 0 0 0 1px var(--border)",
            }}
          >
            {/* Title bar */}
            <div
              className="flex items-center gap-2 px-4 py-3 border-b"
              style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
            >
              <span className="w-3 h-3 rounded-full bg-red-500/70" />
              <span className="w-3 h-3 rounded-full bg-amber-500/70" />
              <span className="w-3 h-3 rounded-full bg-green-500/70" />
              <span
                className="ml-4 text-xs font-medium"
                style={{ color: "var(--muted-fg)" }}
              >
                Churro Coder — {t(active)}
              </span>
            </div>

            {/* Animated screenshot */}
            <div
              className="relative overflow-hidden"
              style={{ backgroundColor: "var(--card)", minHeight: 400 }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                >
                  <Image
                    src={activeTab.src}
                    alt={`Churro Coder ${t(active)} view`}
                    width={1200}
                    height={700}
                    className="w-full object-cover object-top"
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Ambient glow */}
          <div
            className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-2/3 h-32 blur-3xl pointer-events-none"
            style={{ background: "radial-gradient(ellipse, #f59e0b14, transparent 70%)" }}
          />
        </motion.div>
      </div>
    </section>
  );
}
