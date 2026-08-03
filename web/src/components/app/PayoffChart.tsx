import { useMemo } from "react";
import { pnlAtExpiry, fmtUsd } from "../../lib/options";
import { Quote, asset } from "../../data/appdata";

/**
 * SVG payoff-at-expiry diagram, computed from the quote's real legs.
 * Solid mint = the strategy. Dashed fog = just holding (when the position
 * contains the underlying), so the tradeoff is visible, not hidden.
 */
export function PayoffChart({ q }: { q: Quote }) {
  const a = asset(q.assetSymbol);
  const W = 560, H = 220, PAD = 10;

  const model = useMemo(() => {
    const lo = a.spot * 0.62, hi = a.spot * 1.45;
    const N = 120;
    const xs: number[] = [], ys: number[] = [], hold: number[] = [];
    for (let i = 0; i <= N; i++) {
      const px = lo + ((hi - lo) * i) / N;
      xs.push(px);
      ys.push(pnlAtExpiry(px, a.spot, q.assetQty, q.legs));
      hold.push(q.assetQty > 0 ? px - a.spot : 0);
    }
    const all = q.assetQty > 0 ? [...ys, ...hold] : ys;
    const yMin = Math.min(...all), yMax = Math.max(...all);
    const pad = (yMax - yMin) * 0.08 || 1;
    return { lo, hi, xs, ys, hold, yMin: yMin - pad, yMax: yMax + pad };
  }, [q, a]);

  const X = (px: number) => PAD + ((px - model.lo) / (model.hi - model.lo)) * (W - 2 * PAD);
  const Y = (v: number) => H - PAD - ((v - model.yMin) / (model.yMax - model.yMin)) * (H - 2 * PAD);

  const path = model.xs.map((px, i) => `${i ? "L" : "M"}${X(px).toFixed(1)},${Y(model.ys[i]).toFixed(1)}`).join(" ");
  const holdPath = q.assetQty > 0
    ? model.xs.map((px, i) => `${i ? "L" : "M"}${X(px).toFixed(1)},${Y(model.hold[i]).toFixed(1)}`).join(" ")
    : null;

  // profit fill: strategy line clipped above zero
  const zeroY = Y(0);
  const areaPath = `${path} L${X(model.hi).toFixed(1)},${zeroY.toFixed(1)} L${X(model.lo).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const marker = (px: number, label: string, color: string, leftSide = false, row = 0) => (
    <g key={label}>
      <line x1={X(px)} x2={X(px)} y1={PAD} y2={H - PAD} stroke={color} strokeWidth="1" strokeDasharray="3 4" opacity="0.7" />
      <text
        x={leftSide ? X(px) - 4 : X(px) + 4}
        y={PAD + 11 + row * 13}
        textAnchor={leftSide ? "end" : "start"}
        fill={color} fontSize="10" fontFamily="'Courier Prime', monospace"
      >
        {label} {fmtUsd(px)}
      </text>
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Payoff at expiry">
      <defs>
        <clipPath id={`above-${q.strategyId}-${q.assetSymbol}`}>
          <rect x="0" y="0" width={W} height={zeroY} />
        </clipPath>
        <clipPath id={`below-${q.strategyId}-${q.assetSymbol}`}>
          <rect x="0" y={zeroY} width={W} height={H - zeroY} />
        </clipPath>
      </defs>
      {/* zero line */}
      <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="#1E2A26" strokeWidth="1.5" />
      {/* profit / loss shading */}
      <path d={areaPath} fill="#3DFFA8" opacity="0.10" clipPath={`url(#above-${q.strategyId}-${q.assetSymbol})`} />
      <path d={areaPath} fill="#FF6B7A" opacity="0.08" clipPath={`url(#below-${q.strategyId}-${q.assetSymbol})`} />
      {/* hold comparison */}
      {holdPath && <path d={holdPath} fill="none" stroke="#8FA89C" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.8" />}
      {/* strategy */}
      <path d={path} fill="none" stroke="#3DFFA8" strokeWidth="2.5" />
      {/* markers */}
      {marker(a.spot, "now", "#E9F2EC", true)}
      {q.capPrice != null && marker(q.capPrice, "cap", "#FFB84D")}
      {q.floorPrice != null && marker(q.floorPrice, "floor", "#3DFFA8", true, 1)}
      {holdPath && (
        <text x={W - PAD - 4} y={H - PAD - 6} textAnchor="end" fill="#8FA89C" fontSize="10" fontFamily="'Courier Prime', monospace">
          - - just holding
        </text>
      )}
    </svg>
  );
}
