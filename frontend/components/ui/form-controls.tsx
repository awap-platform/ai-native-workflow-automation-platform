"use client";

import {
  useId,
  useState,
  type ComponentProps,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronsUpDown, UploadCloud } from "lucide-react";
import { cn } from "cn";

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

export interface FormFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** Label + control + hint/error wiring, shared by every field. */
export function FormField({ id, label, hint, error, children }: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="awap-label">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-xs awap-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Text-like controls                                                         */
/* -------------------------------------------------------------------------- */

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn("awap-input", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn("awap-textarea", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn("awap-select", className)} {...props}>
      {children}
    </select>
  );
}

/* -------------------------------------------------------------------------- */
/* Toggles                                                                    */
/* -------------------------------------------------------------------------- */

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type"> {
  label: string;
}

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label className={cn("awap-checkbox-row", className)}>
      <input type="checkbox" className="size-4" {...props} />
      <span>{label}</span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

export interface RadioGroupProps {
  legend: string;
  name: string;
  value: string;
  options: RadioOption[];
  onValueChange: (value: string) => void;
}

export function RadioGroup({ legend, name, value, options, onValueChange }: RadioGroupProps) {
  return (
    <fieldset className="grid gap-2">
      <legend className="font-semibold">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="flex items-start gap-2">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onValueChange(option.value)}
            className="mt-1 size-4"
          />
          <span>
            <span className="block">{option.label}</span>
            {option.description ? (
              <span className="block text-xs awap-muted">{option.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, checked, onCheckedChange, disabled }: SwitchProps) {
  return (
    <label className="awap-checkbox-row">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
          checked ? "bg-primary" : "bg-muted",
          disabled && "opacity-50",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "block size-4 rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Date + file                                                                */
/* -------------------------------------------------------------------------- */

export interface DatePickerProps extends Omit<ComponentProps<"input">, "type"> {
  label: string;
}

export function DatePicker({ label, id, ...props }: DatePickerProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <FormField id={inputId} label={label}>
      <Input id={inputId} type="date" {...props} />
    </FormField>
  );
}

export interface FileDropzoneProps {
  label: string;
  accept?: string;
  multiple?: boolean;
  onFilesChange?: (files: File[]) => void;
}

/** Accessible file picker with drag-and-drop affordance (no upload side effect). */
export function FileDropzone({ label, accept, multiple, onFilesChange }: FileDropzoneProps) {
  const inputId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const update = (next: FileList | null) => {
    const list = next ? Array.from(next) : [];
    setFiles(list);
    onFilesChange?.(list);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    update(event.dataTransfer.files);
  };

  return (
    <div className="grid gap-1">
      <span className="awap-label">{label}</span>
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center awap-muted",
          dragging && "border-primary bg-muted",
        )}
      >
        <UploadCloud className="size-6" aria-hidden="true" />
        <span className="text-sm">Choose a file or drag it here</span>
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          onChange={(event) => update(event.target.files)}
        />
      </label>
      {files.length > 0 ? (
        <ul className="awap-list text-xs" aria-label="Selected files">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`}>{file.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Combobox                                                                   */
/* -------------------------------------------------------------------------- */

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

export interface ComboboxProps {
  label: string;
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export function Combobox({
  label,
  options,
  value,
  onValueChange,
  placeholder = "Search…",
}: ComboboxProps) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const filtered = options.filter((option) =>
    `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = options.find((option) => option.value === value);
  const activeOption = filtered[active];

  const choose = (option: ComboboxOption) => {
    onValueChange(option.value);
    setQuery(option.label);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="grid gap-1">
      <label htmlFor={inputId} className="awap-label">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && activeOption ? `${listId}-${activeOption.value}` : undefined}
          className="awap-input pr-9"
          value={open ? query : (selected?.label ?? query)}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <ChevronsUpDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 awap-muted"
          aria-hidden="true"
        />
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-surface p-1 shadow-lg"
          >
            {filtered.length === 0 ? (
              <li className="px-2 py-1 text-xs awap-muted">No matches</li>
            ) : (
              filtered.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${option.value}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={cn(
                    "flex cursor-pointer items-center justify-between rounded px-2 py-1 text-sm",
                    index === active && "bg-muted",
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                >
                  <span>
                    {option.label}
                    {option.description ? (
                      <span className="block text-xs awap-muted">{option.description}</span>
                    ) : null}
                  </span>
                  {option.value === value ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : null}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
