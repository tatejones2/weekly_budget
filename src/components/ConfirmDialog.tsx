import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** require typing this word before the confirm button enables */
  requireText?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, children, confirmLabel, danger, requireText, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = busy || (requireText !== undefined && typed.trim() !== requireText);

  const close = () => {
    setTyped('');
    onCancel();
  };

  return (
    <Modal open={open} title={title} onClose={close} size="sm" initialFocus="[data-autofocus]">
      <div className="stack">
        <div className="prose">{children}</div>
        {requireText !== undefined && (
          <label className="field">
            <span className="field__label">Type {requireText} to confirm</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
          </label>
        )}
        <div className="row row--end">
          <button type="button" className="btn" onClick={close} data-autofocus>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            disabled={blocked}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setTyped('');
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
