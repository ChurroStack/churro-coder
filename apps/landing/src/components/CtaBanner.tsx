"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Download, Github, Star, ArrowRight } from "lucide-react";

export function CtaBanner({ stars }: { stars: number | null }) {
  const t = useTranslations("cta");

  return (
    <section className="py-32 relative overflow-hidden">
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ backgroundColor: "var(--border)" }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{ backgroundColor: "var(--border)" }}
      />

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
          style={{ color: "var(--fg)" }}
        >
          {t("title")}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-lg mb-10"
          style={{ color: "var(--muted-fg)" }}
        >
          {t("subtitle")}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          <a
            href="https://github.com/ChurroStack/churro-coder/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold transition-all duration-200 hover:opacity-90 hover:scale-[1.02]"
            style={{
              backgroundColor: "var(--btn-primary-bg)",
              color: "var(--btn-primary-fg)",
            }}
          >
            <Download className="w-4 h-4" />
            {t("primary")}
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="https://github.com/ChurroStack/churro-coder"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold border transition-all duration-200 hover:scale-[1.02]"
            style={{ borderColor: "var(--border-strong)", color: "var(--fg)" }}
          >
            <Github className="w-4 h-4" />
            {t("secondary")}
            {stars !== null && (
              <span
                className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: "var(--muted)", color: "var(--muted-fg)" }}
              >
                <Star className="w-3 h-3" />
                {stars.toLocaleString()}
              </span>
            )}
          </a>
        </motion.div>
      </div>
    </section>
  );
}
