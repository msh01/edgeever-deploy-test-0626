import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "solid" | "soft" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClassName: Record<ButtonVariant, string> = {
  solid: "bg-emerald-100 text-emerald-950 hover:bg-emerald-200 border-emerald-200",
  soft: "bg-emerald-50 text-emerald-950 hover:bg-emerald-100 border-emerald-100",
  ghost: "bg-transparent text-emerald-800 hover:bg-emerald-50 hover:text-emerald-950 border-transparent",
  outline: "bg-white text-emerald-900 hover:bg-emerald-50 border-emerald-200",
  danger: "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-100",
};

const sizeClassName: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3 text-sm",
  icon: "h-8 w-8 justify-center p-0",
};

export const Button = ({ className, variant = "soft", size = "md", ...props }: ButtonProps) => (
  <button
    className={cn(
      "inline-flex shrink-0 items-center rounded-md border font-medium transition disabled:pointer-events-none disabled:opacity-50",
      variantClassName[variant],
      sizeClassName[size],
      className
    )}
    {...props}
  />
);
