import { useState } from "react";
import { niceMax, type DayCount } from "../dashboard/metrics";

// One series, so one colour and no legend box: the title names what is plotted. Light surface only,
// because the Shopify admin renders embedded apps on white.
const SERIES = "#2a78d6";
const SERIES_HOVER = "#5a9be8";
const SURFACE = "#ffffff";
const GRID = "#ebebe8";
const INK = "#1a1a1a";
const INK_2 = "#616161";

const W = 640;
const H = 236;
const M = { l: 40, r: 8, t: 30, b: 30 };
const PLOT_W = W - M.l - M.r;
const PLOT_H = H - M.t - M.b;
const MAX_BAR = 24;

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fullLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** A column with a 4px rounded data end and a square foot on the baseline. */
function column(x: number, w: number, y: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

export function ClaimsChart({ days }: { days: DayCount[] }) {
  const [active, setActive] = useState<number | null>(null);
  const n = days.length;
  const total = days.reduce((s, d) => s + d.count, 0);
  const top = niceMax(Math.max(...days.map((d) => d.count), 1));
  const slot = PLOT_W / n;
  const barW = Math.min(MAX_BAR, slot - 2);
  const base = M.t + PLOT_H;
  const y = (v: number) => M.t + PLOT_H - (v / top) * PLOT_H;
  const peak = days.reduce((best, d, i) => (d.count > days[best].count ? i : best), 0);
  const last = n - 1;
  const labelled = new Set([days[peak].count > 0 ? peak : -1, days[last].count > 0 ? last : -1]);
  const ticks = [0, top / 2, top];

  if (total === 0) {
    return (
      <div style={{ padding: "28px 0", textAlign: "center", color: INK_2 }}>
        No claims in the last {n} days yet. They will appear here as visitors submit the popup.
      </div>
    );
  }

  const tip = active === null ? null : days[active];
  const cx = (i: number) => M.l + slot * i + slot / 2;

  return (
    <div>
      <div style={{ position: "relative" }} onPointerLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label={`Claims per day, last ${n} days`} style={{ display: "block", height: "auto", fontFamily: "inherit" }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={M.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_2}>
                {t.toLocaleString("en-US")}
              </text>
            </g>
          ))}

          {days.map((d, i) => {
            const h = (d.count / top) * PLOT_H;
            const isActive = active === i;
            return (
              <g
                key={d.date}
                tabIndex={0}
                role="img"
                aria-label={`${fullLabel(d.date)}: ${d.count} ${d.count === 1 ? "claim" : "claims"}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                style={{ outline: "none", cursor: "default" }}
              >
                {/* The hit area is the whole day slot, far larger than the bar it belongs to. */}
                <rect x={M.l + slot * i} y={M.t} width={slot} height={PLOT_H} fill="transparent" />
                {d.count > 0 && (
                  <path d={column(cx(i) - barW / 2, barW, base - h, h)} fill={isActive ? SERIES_HOVER : SERIES} stroke={SURFACE} strokeWidth={0} />
                )}
                {isActive && <rect x={M.l + slot * i + 1} y={M.t} width={slot - 2} height={PLOT_H} fill={SERIES} opacity={0.06} />}
                {labelled.has(i) && d.count > 0 && (
                  <text x={cx(i)} y={base - h - 7} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>
                    {d.count.toLocaleString("en-US")}
                  </text>
                )}
              </g>
            );
          })}

          {/* The baseline is drawn last so it sits above the bar feet. */}
          <line x1={M.l} x2={W - M.r} y1={base} y2={base} stroke="#cfcfcb" strokeWidth={1} />
          {days.map((d, i) =>
            (last - i) % 2 === 0 ? (
              <text key={d.date} x={cx(i)} y={base + 18} textAnchor="middle" fontSize={11} fill={INK_2}>
                {i === last ? "Today" : dayLabel(d.date)}
              </text>
            ) : null,
          )}
        </svg>

        {tip && active !== null && (
          <div
            role="status"
            style={{
              position: "absolute",
              left: `${(cx(active) / W) * 100}%`,
              top: `${((base - (tip.count / top) * PLOT_H) / H) * 100}%`,
              transform: "translate(-50%, calc(-100% - 22px))",
              pointerEvents: "none",
              background: "#1a1a1a",
              color: "#fff",
              padding: "6px 10px",
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: "nowrap",
              boxShadow: "0 2px 8px rgba(0,0,0,.2)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {tip.count.toLocaleString("en-US")} {tip.count === 1 ? "claim" : "claims"}
            </div>
            <div style={{ opacity: 0.75 }}>{fullLabel(tip.date)}</div>
          </div>
        )}
      </div>

      {/* The same numbers without hovering: nothing here is only reachable through the tooltip. */}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 13, color: INK_2 }}>View as table</summary>
        <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: INK_2 }}>
              <th style={{ padding: "4px 0", fontWeight: 500 }}>Day</th>
              <th style={{ padding: "4px 0", fontWeight: 500, textAlign: "right" }}>Claims</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.date} style={{ borderTop: `1px solid ${GRID}` }}>
                <td style={{ padding: "4px 0" }}>{fullLabel(d.date)}</td>
                <td style={{ padding: "4px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{d.count.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
