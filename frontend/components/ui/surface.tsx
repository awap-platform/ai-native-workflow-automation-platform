import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

export function Card({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("awap-card", className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("awap-card-header", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2 className={cn("awap-section-title", className)} {...props}>
      {children}
    </h2>
  );
}

export function CardDescription({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p className={cn("text-sm awap-muted", className)} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("grid gap-3", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("mt-4 flex flex-wrap items-center gap-2", className)} {...props}>
      {children}
    </div>
  );
}

export type StatTone = "default" | "success" | "warning" | "danger";

export interface StatCardProps {
  label: string;
  value: string | number;
  detail?: string;
  tone?: StatTone;
  testId?: string;
}

const statTone: Record<StatTone, string> = {
  default: "text-foreground",
  success: "text-[var(--awap-success)]",
  warning: "text-[var(--awap-warning)]",
  danger: "text-[var(--awap-danger)]",
};

export function StatCard({ label, value, detail, tone = "default", testId }: StatCardProps) {
  return (
    <div className="awap-card" data-testid={testId}>
      <p className="text-sm awap-muted">{label}</p>
      <p className={cn("text-3xl font-bold", statTone[tone])}>{value}</p>
      {detail ? <p className="text-xs awap-muted">{detail}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge                                                                      */
/* -------------------------------------------------------------------------- */

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-foreground",
        primary: "border-transparent bg-primary text-primary-foreground",
        success:
          "border-[var(--awap-success)] bg-[color-mix(in_oklch,var(--awap-success)_15%,var(--awap-surface))] text-foreground",
        warning:
          "border-[var(--awap-warning)] bg-[color-mix(in_oklch,var(--awap-warning)_18%,var(--awap-surface))] text-foreground",
        danger:
          "border-[var(--awap-danger)] bg-[color-mix(in_oklch,var(--awap-danger)_14%,var(--awap-surface))] text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

export interface AvatarProps {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}

const avatarSize = { sm: "size-7 text-xs", md: "size-9 text-sm", lg: "size-12 text-base" };

export function Avatar({ name, src, size = "md" }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-foreground",
        avatarSize[size],
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars accept arbitrary user-provided URLs
        <img src={src} alt="" className="size-full object-cover" />
      ) : null}
      {!src ? <span aria-hidden="true">{initials || "?"}</span> : null}
      <span className="sr-only">{name}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                   */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn("awap-skeleton block", className)}
      {...props}
    />
  );
}

export interface SkeletonGroupProps {
  lines?: number;
  label?: string;
}

export function SkeletonGroup({ lines = 3, label = "Loading" }: SkeletonGroupProps) {
  return (
    <div className="awap-card" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="awap-skeleton-title" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="awap-skeleton-line" />
      ))}
    </div>
  );
}
