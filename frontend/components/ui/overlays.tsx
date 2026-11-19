"use client";

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";
import { IconButton } from "./icon-button";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* -------------------------------------------------------------------------- */
/* Focus management                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Traps Tab inside `ref`, closes on Escape and restores focus to the element
 * that opened the overlay. Used by Dialog, Drawer and CommandPalette.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape?: () => void,
): void {
  const escapeRef = useRef(onEscape);

  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const container = ref.current;
    if (!container) {
      return;
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const elements = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));

    elements()[0]?.focus();

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        escapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const items = elements();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [active, ref]);
}

function Portal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(children, document.body);
}

/* -------------------------------------------------------------------------- */
/* Dialog                                                                     */
/* -------------------------------------------------------------------------- */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  testId?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  testId,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useFocusTrap(panelRef, open, () => onOpenChange(false));

  if (!open) {
    return null;
  }

  return (
    <Portal>
      <div
        className="awap-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onOpenChange(false);
          }
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className="awap-dialog"
          data-testid={testId}
        >
          <div className="awap-card-header">
            <h2 id={titleId} className="awap-section-title">
              {title}
            </h2>
            <IconButton label="Close" onClick={() => onOpenChange(false)} size="icon-sm">
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
          {description ? (
            <p id={descriptionId} className="text-sm awap-muted">
              {description}
            </p>
          ) : null}
          {children}
          {footer ? <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer                                                                     */
/* -------------------------------------------------------------------------- */

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side?: "left" | "right";
  children: ReactNode;
  testId?: string;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  side = "left",
  children,
  testId,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, open, () => onOpenChange(false));

  if (!open) {
    return null;
  }

  return (
    <Portal>
      <div
        className="awap-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onOpenChange(false);
          }
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={cn("awap-drawer", side === "right" ? "awap-drawer-right" : "awap-drawer-left")}
          data-testid={testId}
        >
          <div className="awap-card-header">
            <h2 id={titleId} className="awap-section-title">
              {title}
            </h2>
            <IconButton label="Close" onClick={() => onOpenChange(false)} size="icon-sm">
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
          <div className="grid gap-3">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

/* -------------------------------------------------------------------------- */
/* Tooltip / Popover / Menu                                                   */
/* -------------------------------------------------------------------------- */

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const child = Children.only(children);

  if (!isValidElement(child)) {
    return <>{children}</>;
  }

  const trigger = open
    ? cloneElement(child as ReactElement<{ "aria-describedby": string }>, {
        "aria-describedby": id,
      })
    : child;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {trigger}
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-surface px-2 py-1 text-xs shadow-lg"
      >
        {label}
      </span>
    </span>
  );
}

export interface PopoverProps {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
}

export function Popover({ label, trigger, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <Button
        variant="outline"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-full z-10 mt-1 min-w-56 rounded-md border bg-surface p-3 shadow-xl"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function Menu({ label, trigger, items }: { label: string; trigger: ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }
      event.preventDefault();
      const buttons = Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
      );
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = buttons[(current + delta + buttons.length) % buttons.length];
      next?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative inline-block">
      <Button
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </Button>
      {open ? (
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-10 mt-1 min-w-48 rounded-md border bg-surface p-1 shadow-xl"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cn(
                "block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted",
                item.danger && "text-destructive",
              )}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Toast                                                                      */
/* -------------------------------------------------------------------------- */

export type ToastVariant = "default" | "success" | "danger";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastRecord extends ToastInput {
  id: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toastTone: Record<ToastVariant, string> = {
  default: "",
  success: "awap-alert-success",
  danger: "awap-alert-danger",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = (id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  };

  const toast = (input: ToastInput) => {
    const id = nextId.current + 1;
    nextId.current = id;
    setToasts((current) => [...current, { ...input, id }]);
    window.setTimeout(() => dismiss(id), 5000);
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="awap-toast-viewport"
        aria-live="polite"
        aria-atomic="false"
        data-testid="toast-viewport"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn("awap-toast", toastTone[item.variant ?? "default"])}
          >
            <div>
              <p className="font-semibold">{item.title}</p>
              {item.description ? <p className="text-sm awap-muted">{item.description}</p> : null}
            </div>
            <IconButton label="Dismiss" size="icon-xs" onClick={() => dismiss(item.id)}>
              <X className="size-3" aria-hidden="true" />
            </IconButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Confirm dialog                                                             */
/* -------------------------------------------------------------------------- */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      testId="confirm-dialog"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Command palette                                                            */
/* -------------------------------------------------------------------------- */

export interface CommandItem {
  id: string;
  label: string;
  group?: string;
  keywords?: string[];
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
  title?: string;
  placeholder?: string;
  emptyLabel?: string;
}

export function CommandPalette({
  open,
  onClose,
  items,
  title = "Command palette",
  placeholder = "Search…",
  emptyLabel = "No results",
}: CommandPaletteProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  useFocusTrap(panelRef, open, onClose);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const normalized = query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (!normalized) {
      return true;
    }
    return `${item.label} ${(item.keywords ?? []).join(" ")} ${item.group ?? ""}`
      .toLowerCase()
      .includes(normalized);
  });
  const activeItem = filtered[active];

  const choose = (item: CommandItem) => {
    item.onSelect();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      choose(activeItem);
    }
  };

  return (
    <Portal>
      <div
        className="awap-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="awap-command-panel"
          data-testid="command-palette"
        >
          <div className="awap-card-header">
            <input
              ref={inputRef}
              className="awap-input"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${baseId}-list`}
              aria-activedescendant={activeItem ? `${baseId}-${activeItem.id}` : undefined}
              aria-label={placeholder}
              placeholder={placeholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <IconButton label="Close" size="icon-sm" onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
          <ul
            id={`${baseId}-list`}
            role="listbox"
            aria-label={title}
            className="awap-list max-h-80 overflow-auto"
          >
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-sm awap-muted">{emptyLabel}</li>
            ) : (
              filtered.map((item, index) => (
                <li
                  key={item.id}
                  id={`${baseId}-${item.id}`}
                  role="option"
                  aria-selected={index === active}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded px-2 py-2 text-sm",
                    index === active && "bg-muted",
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(item);
                  }}
                >
                  <span>{item.label}</span>
                  {index === active ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </Portal>
  );
}
