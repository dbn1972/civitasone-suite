import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "civitas-btn civitas-btn--primary",
  secondary: "civitas-btn civitas-btn--secondary",
  ghost: "civitas-btn civitas-btn--ghost",
};

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`${variantClass[variant]} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
