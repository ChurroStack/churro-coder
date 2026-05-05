"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Map, Code2, GitPullRequestDraft, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";
import { Lightbox } from "./Lightbox";

type LightboxData = { src: string; alt: string; width: number; height: number };

const steps: { key: string; icon: LucideIcon; image: string; width: number; height: number }[] = [
  { key: "plan", icon: Map, image: "/images/plan.png", width: 1400, height: 900 },
  { key: "code", icon: Code2, image: "/images/code.png", width: 1400, height: 900 },
  { key: "review", icon: GitPullRequestDraft, image: "/images/review.png", width: 1400, height: 900 },
  { key: "pr", icon: Rocket, image: "/images/multi-window.png", width: 1875, height: 1151 },
];

export function Workflow() {
  const t = useTranslations("workflow");
  const [lightbox, setLightbox] = useState<LightboxData | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <section id="workflow" className="py-32 relative">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, var(--border) 1px, transparent 1px)`,
            backgroundSize: "32px 32px",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 50%, transparent 20%, var(--bg) 80%)",
          }}
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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

          <div className="relative">
            <div
              className="absolute top-8 left-[12.5%] right-[12.5%] h-px hidden lg:block"
              style={{ backgroundColor: "var(--border)" }}
            />

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 lg:gap-6">
              {steps.map(({ key, icon: Icon, image, width, height }, index) => (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    delay: index * 0.12,
                    duration: 0.6,
                    ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
                  }}
                  className="flex flex-col items-center text-center"
                >
                  <div className="relative mb-6">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center border"
                      style={{ backgroundColor: "var(--card)", borderColor: "var(--border-strong)" }}
                    >
                      <Icon className="w-6 h-6" style={{ color: "var(--fg)" }} />
                    </div>
                    <span
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                      style={{ backgroundColor: "var(--fg)", color: "var(--bg)" }}
                    >
                      {index + 1}
                    </span>
                  </div>

                  <span className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--muted-fg)" }}>
                    {t(`${key}.label`)}
                  </span>
                  <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--fg)" }}>
                    {t(`${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--muted-fg)" }}>
                    {t(`${key}.description`)}
                  </p>

                  <motion.button
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.12 + 0.3, duration: 0.5 }}
                    className="mt-6 w-full cursor-zoom-in text-left rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    style={{
                      borderRadius: 24,
                      boxShadow: "0 12px 24px -4px rgba(0,0,0,0.3)",
                    }}
                    onClick={() => {
                      setLightbox({ src: image, alt: t(`${key}.title`), width, height });
                      setOpen(true);
                    }}
                    aria-label={`Expand ${t(`${key}.title`)} screenshot`}
                  >
                    <Image
                      src={image}
                      alt={t(`${key}.title`)}
                      width={width}
                      height={height}
                      className="w-full block"
                      style={{ borderRadius: 24 }}
                    />
                  </motion.button>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {lightbox && (
        <Lightbox
          src={lightbox.src}
          alt={lightbox.alt}
          width={lightbox.width}
          height={lightbox.height}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
