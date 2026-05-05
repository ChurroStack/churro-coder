"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Map, Code2, GitPullRequestDraft, Rocket } from "lucide-react";
import Image from "next/image";

const steps = [
  { key: "plan", icon: Map, color: "#f59e0b", image: "/images/plan.png" },
  { key: "code", icon: Code2, color: "#6366f1", image: "/images/code.png" },
  { key: "review", icon: GitPullRequestDraft, color: "#22c55e", image: "/images/review.png" },
  { key: "pr", icon: Rocket, color: "#ec4899", image: null },
] as const;

export function Workflow() {
  const t = useTranslations("workflow");

  return (
    <section id="workflow" className="py-32 relative overflow-hidden">
      {/* Background accent */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 70% 50% at 50% 50%, #f59e0b0a, transparent)",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
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

        {/* Steps — horizontal on desktop, vertical on mobile */}
        <div className="relative">
          {/* Connector line (desktop) */}
          <div
            className="absolute top-8 left-[12.5%] right-[12.5%] h-px hidden lg:block"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--border) 10%, var(--border) 90%, transparent)",
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 lg:gap-6">
            {steps.map(({ key, icon: Icon, color, image }, index) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.12, duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
                className="flex flex-col items-center text-center"
              >
                {/* Step icon circle */}
                <div className="relative mb-6">
                  {/* Outer ring */}
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: `${color}15`,
                      border: `2px solid ${color}50`,
                      boxShadow: `0 0 24px ${color}20`,
                    }}
                  >
                    <Icon className="w-7 h-7" style={{ color }} />
                  </div>
                  {/* Step number */}
                  <span
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                    style={{ backgroundColor: color, color: "#09090b" }}
                  >
                    {index + 1}
                  </span>
                </div>

                {/* Label */}
                <span
                  className="text-xs font-semibold uppercase tracking-widest mb-1"
                  style={{ color }}
                >
                  {t(`${key}.label`)}
                </span>

                {/* Title */}
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ color: "var(--fg)" }}
                >
                  {t(`${key}.title`)}
                </h3>

                {/* Description */}
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "var(--muted-fg)" }}
                >
                  {t(`${key}.description`)}
                </p>

                {/* Feature image if available */}
                {image && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.12 + 0.3, duration: 0.5 }}
                    className="mt-6 w-full rounded-xl overflow-hidden border"
                    style={{ borderColor: `${color}30` }}
                  >
                    <Image
                      src={image}
                      alt={t(`${key}.title`)}
                      width={400}
                      height={260}
                      className="w-full object-cover object-top"
                    />
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
