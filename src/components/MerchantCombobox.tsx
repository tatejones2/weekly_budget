import { useId, useState } from 'react';
import type { MerchantStat } from '../features/expenses/merchants';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onPick: (m: MerchantStat) => void;
  suggestions: MerchantStat[];
  categoryName: (id: string) => string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
};

export function MerchantCombobox({ value, onChange, onPick, suggestions, categoryName, invalid, describedBy, autoFocus, inputRef }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const showList = open && suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0]!.name === value);

  const pick = (m: MerchantStat) => {
    onPick(m);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="combo">
      <input
        ref={inputRef}
        id={`${id}-input`}
        className="input"
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-label="Merchant or place"
        placeholder="e.g. Bojangles"
        autoComplete="off"
        autoCapitalize="words"
        maxLength={120}
        value={value}
        data-autofocus={autoFocus ? '' : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            pick(suggestions[active]!);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {showList && (
        <ul id={`${id}-list`} className="combo__list" role="listbox" aria-label="Places you've been">
          {suggestions.map((m, i) => (
            <li
              key={m.key}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`combo__opt${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
            >
              <span className="combo__name">{m.name}</span>
              <span className="combo__meta">
                {categoryName(m.lastCategoryId)} · {m.visits} {m.visits === 1 ? 'visit' : 'visits'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
