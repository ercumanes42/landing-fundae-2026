import React, { useEffect, useRef } from "react";
import { useInView, useMotionValue, useSpring } from "motion/react";

interface AnimatedNumberProps {
  value: string;
  className?: string;
}

export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  
  // Extract number and suffix from string like "79,5%" -> number: 79.5, suffix: "%"
  const numericPart = parseFloat(value.replace(",", ".").replace(/[^0-9.]/g, ""));
  const hasComma = value.includes(",");
  const suffix = value.replace(/[0-9,.]/g, "");
  const prefix = value.startsWith("+") ? "+" : "";

  const motionValue = useMotionValue(0);
  const springValue = useSpring(motionValue, {
    damping: 30,
    stiffness: 100,
    duration: 2000
  });

  useEffect(() => {
    if (isInView) {
      motionValue.set(numericPart);
    }
  }, [isInView, motionValue, numericPart]);

  useEffect(() => {
    return springValue.on("change", (latest) => {
      if (ref.current) {
        let displayValue = latest.toFixed(hasComma ? 1 : 0);
        if (hasComma) {
          displayValue = displayValue.replace(".", ",");
        }
        ref.current.textContent = `${prefix}${displayValue}${suffix}`;
      }
    });
  }, [springValue, hasComma, prefix, suffix]);

  return <span ref={ref} className={className}>{value}</span>;
}
