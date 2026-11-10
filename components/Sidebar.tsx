"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatRecord } from "@/lib/chats";
import { DICTATION_LANGUAGES } from "@/lib/dictation";

export function Sidebar({
  chats,
  activeId,
  busyId,
  open,
  collapsed,
  gated,
  onClose,
  onCollapse,
  onSelect,
  onNew,
  onDelete,
  onDeleteAll,
  onSignOut,
  dictationLanguage,
  onDictationLanguage,
}: {
  dictationLanguage: string | null;
  onDictationLanguage: (code: string) => void;
  chats: ChatRecord[];
  activeId: string | null;
  busyId: string | null;
  open: boolean;
  /** Hidden on wide screens (the panel is always a drawer on narrow ones). */
  collapsed: boolean;
  gated: boolean;
  onClose: () => void;
  onCollapse: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
  onSignOut: () => void;
}) {
  // Deleting takes two clicks: the first arms the button for this chat.
  const [armedId, setArmedId] = useState<string | null>(null);
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
        />
      )}
      <aside
        aria-label="Chats"
        className={`fixed inset-y-0 left-0 z-30 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface transition-transform duration-200 md:static md:z-auto md:w-64 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:hidden" : ""}`}
      >
        <div className="flex items-center justify-between px-4 pt-4">
          <span className="font-semibold">Blackthorn Chat</span>
          <button
            onClick={onClose}
            aria-label="Close chat list"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-2 md:hidden"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={onCollapse}
            aria-label="Hide chat list"
            title="Hide chat list"
            className="hidden rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-text md:block"
          >
            <PanelIcon />
          </button>
        </div>

        <div className="p-3">
          <button
            onClick={onNew}
            className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            New chat
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {sorted.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">
              Your chats will appear here. They are saved in this browser only.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sorted.map((chat) => {
                const active = chat.id === activeId;
                const armed = chat.id === armedId;
                return (
                  <li
                    key={chat.id}
                    onMouseLeave={() => armed && setArmedId(null)}
                    className={`group flex items-center rounded-lg ${
                      active ? "bg-surface-2" : "hover:bg-surface-2"
                    }`}
                  >
                    <button
                      onClick={() => onSelect(chat.id)}
                      aria-current={active ? "page" : undefined}
                      title={chat.title}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                    >
                      {chat.id === busyId && (
                        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-text" />
                      )}
                      <span className="truncate">{chat.title}</span>
                    </button>
                    {armed ? (
                      <button
                        onClick={() => {
                          setArmedId(null);
                          onDelete(chat.id);
                        }}
                        onBlur={() => setArmedId(null)}
                        className="mr-1.5 shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                      >
                        Delete?
                      </button>
                    ) : (
                      <button
                        onClick={() => setArmedId(chat.id)}
                        aria-label={`Delete chat: ${chat.title}`}
                        className={`mr-1.5 shrink-0 rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 ${
                          active ? "md:opacity-100" : ""
                        }`}
                      >
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                          <path
                            d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.6 8a1 1 0 001 .9h4.8a1 1 0 001-.9l.6-8M6.6 7v4M9.4 7v4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <Profile
          gated={gated}
          chatCount={chats.length}
          onDeleteAll={onDeleteAll}
          onSignOut={onSignOut}
          dictationLanguage={dictationLanguage}
          onDictationLanguage={onDictationLanguage}
        />
      </aside>
    </>
  );
}

/** A window with its left panel marked: the show/hide panel icon. */
export function PanelIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
        <rect x="1.800" y="2.800" width="12.400" height="10.400" rx="2.200" />
        <path d="M6.200 2.800v10.400" />
      </g>
    </svg>
  );
}

/** The profile button at the foot of the panel, with its small menu. */
function Profile({
  gated,
  chatCount,
  onDeleteAll,
  onSignOut,
  dictationLanguage,
  onDictationLanguage,
}: {
  dictationLanguage: string | null;
  onDictationLanguage: (code: string) => void;
  gated: boolean;
  chatCount: number;
  onDeleteAll: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setArmed(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div ref={containerRef} className="relative border-t border-border p-2">
      {open && (
        <div
          role="menu"
          className="absolute inset-x-2 bottom-full mb-1 rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          <p className="px-3 pb-1 pt-2 text-xs text-muted">
            {gated ? "Signed in with the access password" : "No sign-in on this deployment"}
          </p>
          {dictationLanguage !== null && (
            <div className="px-3 pb-2 pt-1">
              <p className="pb-1.5 text-xs text-muted">Dictation language</p>
              <div className="flex flex-wrap gap-1">
                {DICTATION_LANGUAGES.map((language) => {
                  const selected = language.code === dictationLanguage;
                  return (
                    <button
                      key={language.code}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onDictationLanguage(language.code)}
                      className={`rounded-md border px-2 py-0.5 text-xs ${
                        selected
                          ? "border-text bg-text text-bg"
                          : "border-border text-muted hover:bg-surface-2 hover:text-text"
                      }`}
                    >
                      {language.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <button
            role="menuitem"
            disabled={chatCount === 0}
            onClick={() => {
              if (!armed) return setArmed(true);
              setArmed(false);
              setOpen(false);
              onDeleteAll();
            }}
            className={`${itemClass} ${armed ? "text-danger" : ""}`}
          >
            {armed ? `Delete all ${chatCount} chats?` : "Delete all chats"}
          </button>
          {gated && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className={itemClass}
            >
              Sign out
            </button>
          )}
        </div>
      )}
      <button
        onClick={() => {
          setOpen(!open);
          setArmed(false);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm hover:bg-surface-2"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <circle cx="8" cy="5.600" r="2.600" />
              <path d="M2.800 13.400c.7-2.400 2.800-3.600 5.200-3.600s4.500 1.200 5.200 3.600" />
            </g>
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">Profile</span>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" className="shrink-0 text-muted">
          <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
