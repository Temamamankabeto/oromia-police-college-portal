"use client";

import { useEffect, useRef, useState } from "react";

export type ActionMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

type ActionMenuProps = {
  label: string;
  items: ActionMenuItem[];
};

export default function ActionMenu({
  label,
  items,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function focusItem(start: number, direction: number) {
    if (items.length === 0) return;

    for (let offset = 0; offset < items.length; offset++) {
      const index =
        (start + direction * offset + items.length * 2) %
        items.length;

      if (!items[index].disabled) {
        itemRefs.current[index]?.focus();
        return;
      }
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);

            requestAnimationFrame(() => {
              focusItem(
                event.key === "ArrowDown" ? 0 : items.length - 1,
                event.key === "ArrowDown" ? 1 : -1
              );
            });
          }
        }}
        className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-5 w-5"
        >
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            }

            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();

              const index = itemRefs.current.findIndex(
                item => item === document.activeElement
              );

              focusItem(
                index < 0 ? 0 : index + (event.key === "ArrowDown" ? 1 : -1),
                event.key === "ArrowDown" ? 1 : -1
              );
            }

            if (event.key === "Home") {
              event.preventDefault();
              focusItem(0, 1);
            }

            if (event.key === "End") {
              event.preventDefault();
              focusItem(items.length - 1, -1);
            }

            if (event.key === "Tab") {
              setOpen(false);
            }
          }}
          className="absolute right-0 z-50 mt-2 min-w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {items.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              ref={element => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ${
                item.destructive
                  ? "text-red-700 hover:bg-red-50"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}