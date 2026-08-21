import * as React from "react";
import { cn } from "../../lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF206E] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none",
          {
            "bg-[#302B7B] text-white hover:bg-[#241F65] rounded-full shadow-sm": variant === "primary",
            "bg-[#B80B4B] text-white hover:bg-[#96083D] rounded-xl shadow-lg": variant === "secondary",
            "border border-slate-200 bg-transparent hover:bg-slate-50 text-slate-900 rounded-full": variant === "outline",
            "hover:bg-slate-100 text-slate-700 rounded-full": variant === "ghost",
            "bg-red-600 text-white hover:bg-red-700 rounded-full": variant === "danger",
            "h-11 px-4 py-2": size === "sm",
            "h-11 px-6 py-3": size === "md",
            "h-14 px-8 py-4 text-base": size === "lg",
          },
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
