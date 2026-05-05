"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Layers, Eye, Zap, Lock, GitBranch, MonitorPlay } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const features: { key: string; icon: LucideIcon }[] = [
  { key: "multiProvider", icon: Layers },
  { key: "planMode", icon: Eye },
  { key: "agentMode", icon: Zap },
  { key: "localFirst", icon: Lock },
  { key: "gitIntegration", icon: GitBranch },
  { key: "realTime", icon: MonitorPlay },
];

export function Features() {
  const t = useTranslations("features");

  return (
    <section id="features" className="py-32 relative overflow-hidden">
      {/* Dotted background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, var(--border-strong) 1px, transparent 1px)`,
          backgroundSize: "32px 32px",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 50%, transparent 30%, var(--bg) 85%)",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
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

        {/* Card grid — outer border + dividing lines between cells */}
        <div
          className="rounded-2xl overflow-hidden border"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ key, icon: Icon }, i) => {
              const isLastRow = i >= 3;
              const isLastCol = (i + 1) % 3 === 0;
              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.07, duration: 0.5 }}
                  className="p-8 transition-colors duration-200 group"
                  style={{
                    backgroundColor: "var(--bg)",
                    borderRight: !isLastCol ? `1px solid var(--border)` : undefined,
                    borderBottom: !isLastRow ? `1px solid var(--border)` : undefined,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--card)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg)";
                  }}
                >
                  <div
                    className="flex items-center justify-center w-10 h-10 rounded-lg mb-5 border"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--muted)" }}
                  >
                    <Icon className="w-5 h-5" style={{ color: "var(--fg)" }} />
                  </div>
                  <h3 className="text-base font-semibold mb-2" style={{ color: "var(--fg)" }}>
                    {t(`${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--muted-fg)" }}>
                    {t(`${key}.description`)}
                  </p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
