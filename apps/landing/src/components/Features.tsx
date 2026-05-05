"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Layers,
  Eye,
  Zap,
  Lock,
  GitBranch,
  MonitorPlay,
} from "lucide-react";
import { cn } from "@/lib/utils";

const features = [
  { key: "multiProvider", icon: Layers, color: "#6366f1" },
  { key: "planMode", icon: Eye, color: "#f59e0b" },
  { key: "agentMode", icon: Zap, color: "#f97316" },
  { key: "localFirst", icon: Lock, color: "#22c55e" },
  { key: "gitIntegration", icon: GitBranch, color: "#ec4899" },
  { key: "realTime", icon: MonitorPlay, color: "#06b6d4" },
] as const;

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

export function Features() {
  const t = useTranslations("features");

  return (
    <section id="features" className="py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
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

        {/* Feature grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {features.map(({ key, icon: Icon, color }) => (
            <motion.div
              key={key}
              variants={cardVariants}
              className={cn(
                "group relative p-6 rounded-2xl border transition-all duration-300",
                "hover:scale-[1.02]"
              )}
              style={{
                backgroundColor: "var(--card)",
                borderColor: "var(--border)",
              }}
            >
              {/* Subtle gradient on hover */}
              <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{
                  background: `radial-gradient(ellipse at top left, ${color}12, transparent 60%)`,
                }}
              />

              <div
                className="relative flex items-center justify-center w-11 h-11 rounded-xl mb-4"
                style={{ backgroundColor: `${color}18`, border: `1px solid ${color}30` }}
              >
                <Icon className="w-5 h-5" style={{ color }} />
              </div>

              <h3
                className="relative text-base font-semibold mb-2"
                style={{ color: "var(--fg)" }}
              >
                {t(`${key}.title`)}
              </h3>
              <p className="relative text-sm leading-relaxed" style={{ color: "var(--muted-fg)" }}>
                {t(`${key}.description`)}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
