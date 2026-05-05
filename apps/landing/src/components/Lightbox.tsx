"use client";

import { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

interface LightboxProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  open: boolean;
  onClose: () => void;
}

export function Lightbox({ src, alt, width, height, open, onClose }: LightboxProps) {
  const t = useTranslations("lightbox");
  const handleKey = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, handleKey]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
          onClick={onClose}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 flex items-center justify-center w-10 h-10 rounded-full transition-colors"
            style={{ backgroundColor: "rgba(255,255,255,0.15)", color: "#fff" }}
            aria-label={t("close")}
          >
            <X className="w-5 h-5" />
          </button>

          {/* Image */}
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] }}
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
            style={{ borderRadius: 24, overflow: "hidden" }}
          >
            <Image
              src={src}
              alt={alt}
              width={width}
              height={height}
              className="block w-auto h-auto max-w-[90vw] max-h-[90vh] object-contain"
              style={{ borderRadius: 24 }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
