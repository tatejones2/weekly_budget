import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** narrower dialogs for confirmations */
  size?: 'sm' | 'md';
  initialFocus?: string; // CSS selector
};

/** Native <dialog>: focus trap, Esc-to-close and inert background come for free. Becomes a bottom sheet on phones. */
export function Modal({ open, title, onClose, children, size = 'md', initialFocus }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`m-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (initialFocus) d.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && d.open) d.close();
  }, [open, initialFocus]);

  return (
    <dialog
      ref={ref}
      className={`modal modal--${size}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
    >
      {open && (
        <div className="modal__panel">
          <header className="modal__head">
            <h2 id={titleId} className="modal__title">
              {title}
            </h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} aria-hidden />
            </button>
          </header>
          <div className="modal__body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
