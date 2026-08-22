import { X } from "lucide-react";
import { forwardRef, useEffect, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-sm",
        variant === "primary" && "bg-brand text-white shadow-sm hover:bg-brand/90",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-raised",
        variant === "ghost" && "text-muted hover:bg-raised hover:text-ink",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("field", className)} {...props} />
));
Input.displayName = "Input";

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" | "red" | "purple"; className?: string }) {
  const tones = {
    neutral: "bg-raised text-muted border-line",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/20",
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    red: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
    purple: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/20"
  };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", tones[tone], className)}>{children}</span>;
}

export function Avatar({ name, url, size = "md", className }: { name: string; url?: string | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials = name.trim().split(/\s+/u).map((part) => part[0] ?? "").join("").slice(0, 2).toUpperCase();
  const styles = size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs";
  return url ? (
    <img src={url} alt={`${name} 프로필`} className={cn("rounded-full border border-line object-cover", styles, className)} referrerPolicy="no-referrer" />
  ) : (
    <span title={name} className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-brand/20 bg-brand/10 font-bold text-brand", styles, className)}>{initials || "?"}</span>
  );
}

export function Modal({ open, onClose, title, description, children, className }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className={cn("max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl sm:p-6", className)}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><h2 id="modal-title" className="text-lg font-bold text-ink">{title}</h2>{description && <p className="mt-1 text-sm text-muted">{description}</p>}</div>
          <Button variant="ghost" size="sm" aria-label="닫기" title="닫기" className="h-8 w-8 p-0" onClick={onClose}><X size={17} /></Button>
        </div>
        {children}
      </section>
    </div>,
    document.body
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-raised/50 p-8 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">{icon}</div><h3 className="font-bold text-ink">{title}</h3><p className="mt-1 max-w-md text-sm text-muted">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div className="min-w-0">{eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}<h1 className="break-words text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>{description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{description}</p>}</div>{action && <div className="flex flex-wrap items-center gap-2">{action}</div>}</div>;
}

export function StatCard({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: string; icon: ReactNode }) {
  return <div className="panel flex h-full min-h-32 flex-col p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-muted">{label}</span><span className="shrink-0 text-brand">{icon}</span></div><div className="mt-auto pt-3 text-2xl font-extrabold text-ink">{value}</div>{detail && <p className="mt-1 min-h-4 text-xs text-muted">{detail}</p>}</div>;
}

export function Alert({ children, tone = "error", className }: { children: ReactNode; tone?: "error" | "info" | "success"; className?: string }) {
  const styles = tone === "error" ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300" : tone === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  return <div className={cn("rounded-xl border px-3.5 py-3 text-sm", styles, className)}>{children}</div>;
}

export function Spinner({ className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("h-5 w-5 animate-spin rounded-full border-2 border-brand/25 border-t-brand", className)} aria-label="로딩 중" />;
}
