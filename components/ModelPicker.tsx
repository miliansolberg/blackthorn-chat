"use client";

import { useEffect, useId, useRef, useState } from "react";

type ModelInfo = { id: string; name: string };

/** The model selector: a button that opens a small list above the message box. */
export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selectedIndex = Math.max(
    0,
    models.findIndex((model) => model.id === value),
  );
  const selected = models[selectedIndex];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function toggle() {
    setHighlighted(selectedIndex);
    setOpen(!open);
  }

  function choose(index: number) {
    onChange(models[index].id);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        toggle();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((highlighted + 1) % models.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((highlighted - 1 + models.length) % models.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlighted(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlighted(models.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(highlighted);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-0" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label="Model"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
        onClick={toggle}
        className={`flex max-w-full items-center gap-2 rounded-lg border border-border py-1.5 pl-3 pr-2.5 text-sm font-medium hover:bg-surface-2 ${
          open ? "bg-surface-2" : ""
        }`}
      >
        <span className="truncate">{selected?.name}</span>
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="model-menu absolute bottom-full left-0 z-20 mb-2 w-64 max-w-[80vw] rounded-xl border border-border bg-surface p-1 shadow-xl shadow-black/30">
          <p className="px-3 pb-1.5 pt-2 text-xs font-medium uppercase tracking-wider text-muted">
            Model
          </p>
          <ul id={listId} role="listbox" aria-label="Model" className="max-h-64 overflow-y-auto">
            {models.map((model, index) => {
              const isSelected = index === selectedIndex;
              return (
                <li
                  key={model.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(index)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${
                    index === highlighted ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{model.name}</span>
                    <span className="truncate font-mono text-[11px] text-muted">{model.id}</span>
                  </span>
                  {isSelected && (
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="shrink-0">
                      <path
                        d="M3.500 8.500l3 3 6-7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
