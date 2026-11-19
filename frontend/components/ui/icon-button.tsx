import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./button";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
  /** Accessible name; also used as the native tooltip. */
  label: string;
  children: ReactNode;
}

/** Square icon-only button with a guaranteed accessible name. */
export function IconButton({ label, children, size = "icon", variant = "ghost", ...props }: IconButtonProps) {
  return (
    <Button
      size={size}
      variant={variant}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}
