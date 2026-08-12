import { cn } from "@/lib/cn";

/**
 * Card — Surface bg, 1px border, rounded-lg, subtle shadow (DESIGN.md). Optional
 * title/subtitle header.
 */
export function Card({
  title,
  subtitle,
  headerAction,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-gray-200 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-800",
        className,
      )}
    >
      {title && (
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {subtitle}
              </p>
            )}
          </div>
          {headerAction}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

/**
 * KPI Card — overline label, large value, optional subtitle (DESIGN.md). `tone`
 * tints the value for emphasis.
 */
export function Kpi({
  label,
  value,
  subtitle,
  tone = "default",
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: "default" | "growth" | "brand" | "attention";
}) {
  const toneClass =
    tone === "growth"
      ? "text-green-600 dark:text-green-400"
      : tone === "brand"
        ? "text-blue-600 dark:text-blue-400"
        : tone === "attention"
          ? "text-amber-600 dark:text-amber-400"
        : "text-gray-900 dark:text-gray-100";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className={cn("mt-1 text-2xl font-bold", toneClass)}>{value}</p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/** Primary button — brand bg, white text, rounded-lg (DESIGN.md). */
export function Button({
  children,
  className,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    ghost:
      "border border-gray-300 bg-transparent text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700",
  } as const;
  return (
    <button className={cn(base, variants[variant], className)} {...props}>
      {children}
    </button>
  );
}

/** Tinted info/warning/error banner (DESIGN.md). */
export function Banner({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "error";
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    info: "bg-blue-50 border-blue-100 text-blue-800 dark:bg-blue-900/20 dark:border-blue-900/40 dark:text-blue-200",
    warning:
      "bg-amber-50 border-amber-100 text-amber-800 dark:bg-amber-900/20 dark:border-amber-900/40 dark:text-amber-200",
    error:
      "bg-red-50 border-red-100 text-red-800 dark:bg-red-900/20 dark:border-red-900/40 dark:text-red-200",
  } as const;
  return (
    <div className={cn("rounded-lg border p-4 text-sm", tones[tone])}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}
