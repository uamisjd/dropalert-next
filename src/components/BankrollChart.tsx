"use client";

/**
 * Grafico SVG inline dello storico bankroll.
 * Nessuna libreria esterna: solo SVG puro, leggero e accessibile.
 */

interface BankrollChartProps {
  history: Array<{ date: string; bankroll: number }>;
  width?: number;
  height?: number;
}

export function BankrollChart({ history, width = 600, height = 200 }: BankrollChartProps) {
  if (history.length < 2) return null;

  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const values = history.map((h) => h.bankroll);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  // Aggiungi un po' di padding verticale
  const yMin = minVal - range * 0.05;
  const yMax = maxVal + range * 0.05;
  const yRange = yMax - yMin;

  const points = history.map((h, i) => {
    const x = padding.left + (i / (history.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((h.bankroll - yMin) / yRange) * chartHeight;
    return { x, y, ...h };
  });

  // Linea del bankroll
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  // Area sotto la linea
  const areaD =
    pathD +
    ` L ${points[points.length - 1].x.toFixed(1)} ${(padding.top + chartHeight).toFixed(1)}` +
    ` L ${points[0].x.toFixed(1)} ${(padding.top + chartHeight).toFixed(1)} Z`;

  const startVal = history[0].bankroll;
  const endVal = history[history.length - 1].bankroll;
  const isPositive = endVal >= startVal;

  // Griglia Y (5 linee)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const val = yMin + (yRange * i) / 4;
    const y = padding.top + chartHeight - ((val - yMin) / yRange) * chartHeight;
    return { val, y };
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-900">Storico Bankroll</h3>
        <span className={`text-sm font-bold tabular-nums ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
          {isPositive ? "+" : ""}€{(endVal - startVal).toFixed(0)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="Grafico storico del bankroll"
      >
        {/* Griglia orizzontale */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              y1={tick.y}
              x2={width - padding.right}
              y2={tick.y}
              stroke="#e2e8f0"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <text
              x={padding.left - 8}
              y={tick.y + 4}
              textAnchor="end"
              className="text-[10px] fill-slate-400"
            >
              €{tick.val.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Linea di riferimento iniziale */}
        <line
          x1={padding.left}
          y1={padding.top + chartHeight - ((startVal - yMin) / yRange) * chartHeight}
          x2={width - padding.right}
          y2={padding.top + chartHeight - ((startVal - yMin) / yRange) * chartHeight}
          stroke="#94a3b8"
          strokeWidth="1"
          strokeDasharray="6 3"
        />

        {/* Area sotto la linea */}
        <path
          d={areaD}
          fill={isPositive ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)"}
        />

        {/* Linea del bankroll */}
        <path
          d={pathD}
          fill="none"
          stroke={isPositive ? "#10b981" : "#ef4444"}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Punti */}
        {points.length <= 30 &&
          points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="3"
              fill={isPositive ? "#10b981" : "#ef4444"}
              stroke="white"
              strokeWidth="1.5"
            >
              <title>
                {p.date}: €{p.bankroll.toFixed(2)}
              </title>
            </circle>
          ))}

        {/* Etichette X (prima e ultima) */}
        <text
          x={padding.left}
          y={height - 5}
          textAnchor="start"
          className="text-[10px] fill-slate-400"
        >
          {history[0].date}
        </text>
        <text
          x={width - padding.right}
          y={height - 5}
          textAnchor="end"
          className="text-[10px] fill-slate-400"
        >
          {history[history.length - 1].date}
        </text>
      </svg>
    </div>
  );
}
