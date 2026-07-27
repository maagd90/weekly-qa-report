import React, { useEffect, useId, useRef } from 'react';

export interface DetailDrawerBaseProps {
  isOpen: boolean;
  title: string;
  closeLabel?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function formatDetailDate(value?: string | null): string {
  const normalized = value?.trim();
  if (!normalized) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : normalized;
}

export function DetailDrawerBase({
  isOpen,
  title,
  closeLabel = 'Close details',
  onClose,
  children,
}: DetailDrawerBaseProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )];
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleDialogKey);
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end print:hidden">
      <button
        type="button"
        tabIndex={-1}
        className="hidden flex-1 bg-black/30 sm:block"
        onClick={onClose}
        aria-label={closeLabel}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="qa-scroll w-full max-w-md overflow-y-auto border-l border-qa-border bg-[#F5F3ED] shadow-xl"
      >
        <div className="border-b-2 border-qa-ink p-4 sm:p-6">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="mb-3 min-h-11 cursor-pointer border-none bg-transparent font-mono-qa text-[11px] text-qa-muted-light sm:mb-4 sm:min-h-0"
          >
            ← Back to list
          </button>
          <h2 id={titleId} className="m-0 font-spectral text-xl font-bold">{title}</h2>
        </div>
        <div className="space-y-5 p-4 sm:p-6">{children}</div>
      </aside>
    </div>
  );
}
