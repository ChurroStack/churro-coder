"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Lightbox } from "./Lightbox";

const tabs = [
  { key: "usage", src: "/images/usage.png", width: 1791, height: 1159, maxHeight: 900 },
  { key: "plan", src: "/images/plan.png", width: 1791, height: 1159, maxHeight: 900 },
  { key: "code", src: "/images/code.png", width: 1791, height: 1159, maxHeight: 900 },
  { key: "review", src: "/images/review.png", width: 1791, height: 1159, maxHeight: 900 },
  { key: "pr", src: "/images/finish-pr.png", width: 1917, height: 1285, maxHeight: 840 },
] as const;

type LightboxData = { src: string; alt: string; width: number; height: number };

export function Screenshots() {
  const t = useTranslations("screenshots");
  const [active, setActive] = useState<(typeof tabs)[number]["key"]>("usage");
  const [lightbox, setLightbox] = useState<LightboxData | null>(null);
  const [open, setOpen] = useState(false);

  const activeTab = tabs.find((tab) => tab.key === active)!;

  return (
    <>
      <section id="screenshots" className="py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
                  className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200")}
                  style={
                    active === tab.key
                      ? { backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }
                      : { color: "var(--muted-fg)" }
                  }
                >
                  {t(tab.key)}
                </button>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div style={{ minHeight: 400 }}>
              <AnimatePresence mode="wait">
                <motion.button
                  key={active}
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="w-full cursor-zoom-in text-left rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    borderRadius: 24,
                    boxShadow: "0 24px 48px -8px rgba(0,0,0,0.35)",
                  }}
                  onClick={() => {
                    setLightbox({
                      src: activeTab.src,
                      alt: `Churro Coder ${t(active)} view`,
                      width: activeTab.width,
                      height: activeTab.height,
                    });
                    setOpen(true);
                  }}
                  aria-label={`Expand ${t(active)} screenshot`}
                >
                  <div className="overflow-hidden" style={{ borderRadius: 24, maxHeight: activeTab.maxHeight }}>
                    <Image
                      src={activeTab.src}
                      alt={`Churro Coder ${t(active)} view`}
                      width={activeTab.width}
                      height={activeTab.height}
                      className="w-full block"
                    />
                  </div>
                </motion.button>
              </AnimatePresence>
            </div>
          </motion.div>
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
