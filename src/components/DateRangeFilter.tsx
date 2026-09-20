import { PRESET_LABELS, type DateRange, type RangePreset } from '../features/expenses/filters';

type Props = {
  preset: RangePreset;
  custom: DateRange;
  onPreset: (p: RangePreset) => void;
  onCustom: (r: DateRange) => void;
  presets?: RangePreset[];
  idPrefix: string;
};

export function DateRangeFilter({ preset, custom, onPreset, onCustom, presets = ['all', 'this-week', 'last-week', 'last-4', 'last-12', 'this-month', 'custom'], idPrefix }: Props) {
  return (
    <>
      <div className="field">
        <label className="label" htmlFor={`${idPrefix}-preset`}>Period</label>
        <select id={`${idPrefix}-preset`} className="input" value={preset} onChange={(e) => onPreset(e.target.value as RangePreset)}>
          {presets.map((p) => (
            <option key={p} value={p}>{PRESET_LABELS[p]}</option>
          ))}
        </select>
      </div>
      {preset === 'custom' && (
        <>
          <div className="field">
            <label className="label" htmlFor={`${idPrefix}-from`}>From</label>
            <input id={`${idPrefix}-from`} type="date" className="input" value={custom.from ?? ''} max={custom.to || undefined} onChange={(e) => onCustom({ ...custom, from: e.target.value || undefined })} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${idPrefix}-to`}>To</label>
            <input id={`${idPrefix}-to`} type="date" className="input" value={custom.to ?? ''} min={custom.from || undefined} onChange={(e) => onCustom({ ...custom, to: e.target.value || undefined })} />
          </div>
        </>
      )}
    </>
  );
}
