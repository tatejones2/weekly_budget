import { formatCentsCompact } from '../lib/money';

export type Bar = { label: string; value: number; marker?: number; highlight?: boolean; title: string };

type Props = { bars: Bar[]; ariaLabel: string; markerLabel?: string };

/**
 * Simple bar chart in inline SVG. Not colour-only: every bar has a text label,
 * a value label (when there's room), and a full-sentence <title>. Pair it with a
 * numeric table on the page.
 */
export function BarChart({ bars, ariaLabel, markerLabel }: Props) {
  const W = 640;
  const H = 240;
  const pad = { l: 44, r: 8, t: 20, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const rawMax = Math.max(1, ...bars.map((b) => Math.max(b.value, b.marker ?? 0)));
  const step = niceStep(rawMax / 4);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const slot = innerW / Math.max(bars.length, 1);
  const barW = Math.min(44, slot * 0.6);
  const y = (v: number) => pad.t + innerH - (Math.max(v, 0) / max) * innerH;
  const showValues = bars.length <= 8;
  const labelEvery = bars.length > 12 ? 2 : 1;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="chart__axis">
              {formatCentsCompact(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const h = Math.max(0, pad.t + innerH - y(b.value));
          return (
            <g key={i}>
              <title>{b.title}</title>
              <rect x={cx - barW / 2} y={y(b.value)} width={barW} height={h} className={b.highlight ? 'chart__bar chart__bar--hl' : 'chart__bar'} />
              {b.marker !== undefined && <line x1={cx - barW / 2 - 4} x2={cx + barW / 2 + 4} y1={y(b.marker)} y2={y(b.marker)} className="chart__marker" />}
              {showValues && b.value > 0 && (
                <text x={cx} y={y(b.value) - 5} textAnchor="middle" className="chart__val">
                  {formatCentsCompact(b.value)}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="chart__axis">
                  {b.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {markerLabel && (
        <figcaption className="chart__legend">
          <span className="key key--bar" aria-hidden /> Spent
          <span className="key key--marker" aria-hidden /> {markerLabel}
        </figcaption>
      )}
    </figure>
  );
}

function niceStep(raw: number): number {
  // step in cents, snapped to 1/2/5 × 10^n dollars
  const dollars = Math.max(raw / 100, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(dollars)));
  const n = dollars / pow;
  const snapped = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return snapped * pow * 100;
}
