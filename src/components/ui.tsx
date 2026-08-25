import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";

const POPOVER_OPEN_EVENT = "team-rocket:popover-open";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "ui-button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-sm",
        variant === "primary" && "ui-button--primary text-white",
        variant === "secondary" && "ui-button--secondary text-ink",
        variant === "ghost" && "ui-button--ghost text-muted",
        variant === "danger" && "ui-button--danger",
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
    <div className="layer-dialog fixed inset-0 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className={cn("glass-strong max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl p-5 sm:p-6", className)}>
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

export interface PopoverTriggerProps {
  "aria-controls": string;
  "aria-expanded": boolean;
  "aria-haspopup": "dialog" | "menu";
  onClick: () => void;
  ref: RefObject<HTMLButtonElement>;
}

export function Popover({
  label,
  trigger,
  children,
  align = "right",
  role = "dialog",
  className,
  dismissKey,
}: {
  label: string;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  role?: "dialog" | "menu";
  className?: string;
  dismissKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const contentId = `${id}-content`;
  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  useEffect(() => {
    close();
  }, [close, dismissKey]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const triggerElement = triggerRef.current;
      const contentElement = contentRef.current;
      if (!triggerElement || !contentElement) return;

      const viewportMargin = 12;
      const gap = 8;
      const triggerRect = triggerElement.getBoundingClientRect();
      const contentWidth = Math.min(contentElement.offsetWidth, window.innerWidth - viewportMargin * 2);
      const naturalHeight = contentElement.scrollHeight;
      const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - gap - viewportMargin);
      const spaceAbove = Math.max(0, triggerRect.top - gap - viewportMargin);
      const placeAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
      const maxHeight = Math.max(96, placeAbove ? spaceAbove : spaceBelow);
      const renderedHeight = Math.min(naturalHeight, maxHeight);
      const preferredLeft = align === "right" ? triggerRect.right - contentWidth : triggerRect.left;
      const left = Math.min(
        Math.max(viewportMargin, preferredLeft),
        Math.max(viewportMargin, window.innerWidth - contentWidth - viewportMargin),
      );
      const top = placeAbove
        ? Math.max(viewportMargin, triggerRect.top - gap - renderedHeight)
        : Math.min(triggerRect.bottom + gap, window.innerHeight - renderedHeight - viewportMargin);

      setPosition({ left, top: Math.max(viewportMargin, top), maxHeight });
    };

    updatePosition();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (contentRef.current) observer?.observe(contentRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !contentRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    const onOtherPopover = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(POPOVER_OPEN_EVENT, onOtherPopover);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(POPOVER_OPEN_EVENT, onOtherPopover);
    };
  }, [close, id, open]);

  const toggle = () => {
    const next = !open;
    if (next) window.dispatchEvent(new CustomEvent(POPOVER_OPEN_EVENT, { detail: id }));
    if (next) {
      setPosition(null);
      setOpen(true);
    } else {
      close();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        "aria-controls": contentId,
        "aria-expanded": open,
        "aria-haspopup": role,
        onClick: toggle,
        ref: triggerRef,
      })}
      {open && createPortal(
        <div
          ref={contentRef}
          id={contentId}
          role={role}
          aria-label={label}
          className={cn(
            "glass-popover popover-floating layer-popover fixed rounded-2xl",
            className,
          )}
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            maxHeight: position?.maxHeight,
            visibility: position ? "visible" : "hidden",
          }}
        >
          {typeof children === "function" ? children(close) : children}
        </div>,
        document.body,
      )}
    </div>
  );
}

export function Toast({
  message,
  tone = "success",
  onDismiss,
  duration,
}: {
  message: string;
  tone?: ToastTone;
  onDismiss: () => void;
  duration?: number;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(
      onDismiss,
      duration ?? (tone === "error" ? 6500 : tone === "warning" ? 5000 : 3500),
    );
    return () => window.clearTimeout(timeout);
  }, [duration, message, onDismiss, tone]);
  const icon = tone === "success"
    ? <CheckCircle2 size={18} />
    : tone === "error"
      ? <XCircle size={18} />
      : tone === "warning"
        ? <AlertTriangle size={18} />
        : <Info size={18} />;
  const styles = {
    success: "border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
    error: "border-red-500/20 text-red-700 dark:text-red-300",
    warning: "border-amber-500/20 text-amber-700 dark:text-amber-300",
    info: "border-blue-500/20 text-blue-700 dark:text-blue-300",
  } satisfies Record<ToastTone, string>;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "glass-popover flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold",
        styles[tone],
      )}
    >
      <span className="shrink-0" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        aria-label="알림 닫기"
        className="rounded-md p-1 text-muted hover:bg-raised hover:text-ink"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export type ToastTone = "success" | "error" | "warning" | "info";

interface ToastEntry {
  id: number;
  message: string;
  tone: ToastTone;
  duration?: number;
  dedupeKey: string;
}

interface ToastOptions {
  tone?: ToastTone;
  duration?: number;
  dedupeKey?: string;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
  dismissToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let toastSequence = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    const tone = options.tone ?? "info";
    const dedupeKey = options.dedupeKey ?? `${tone}:${message}`;
    setToasts((current) => {
      if (current.some((toast) => toast.dedupeKey === dedupeKey)) return current;
      const next: ToastEntry = {
        id: ++toastSequence,
        message,
        tone,
        dedupeKey,
        ...(options.duration !== undefined ? { duration: options.duration } : {}),
      };
      return [...current, next].slice(-6);
    });
  }, []);
  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          data-toast-viewport
          className="layer-toast fixed inset-x-4 bottom-20 flex flex-col gap-2 sm:left-auto sm:right-5 sm:w-[min(420px,calc(100vw-2.5rem))]"
          aria-label="작업 알림"
        >
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              message={toast.message}
              tone={toast.tone}
              onDismiss={() => dismissToast(toast.id)}
              {...(toast.duration !== undefined ? { duration: toast.duration } : {})}
            />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center"><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand/15 bg-brand/10 text-brand shadow-sm">{icon}</div><h3 className="font-bold text-ink">{title}</h3><p className="mt-1 max-w-md text-sm text-muted">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div className="min-w-0">{eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}<h1 className="break-words text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>{description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{description}</p>}</div>{action && <div className="flex flex-wrap items-center gap-2">{action}</div>}</div>;
}

export function StatCard({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: string; icon: ReactNode }) {
  return <div className="panel stat-card flex h-full min-h-32 flex-col p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold text-muted">{label}</span><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">{icon}</span></div><div className="mt-auto pt-3 text-2xl font-extrabold tracking-tight text-ink">{value}</div>{detail && <p className="mt-1 min-h-4 text-xs text-muted">{detail}</p>}</div>;
}

export function Alert({ children, tone = "error", className }: { children: ReactNode; tone?: "error" | "info" | "success"; className?: string }) {
  const styles = tone === "error" ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300" : tone === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  return <div className={cn("rounded-xl border px-3.5 py-3 text-sm", styles, className)}>{children}</div>;
}

export function Spinner({ className }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("h-5 w-5 animate-spin rounded-full border-2 border-brand/25 border-t-brand", className)} aria-label="로딩 중" />;
}
