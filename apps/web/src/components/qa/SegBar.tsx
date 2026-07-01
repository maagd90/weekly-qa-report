import React from 'react';
import { displayResultColor } from '../../theme/qaTheme';

interface SegSegment {
  widthPct: number;
  color: string;
  opacity?: number;
}

export function SegBar({ segments, height = 16 }: { segments: SegSegment[]; height?: number }) {
  return (
    <div className="flex w-full bg-qa-track" style={{ height }}>
      {segments.filter((s) => s.widthPct > 0).map((s, i) => (
        <div
          key={i}
          style={{
            width: `${s.widthPct}%`,
            background: s.color,
            height: '100%',
            opacity: s.opacity ?? 1,
          }}
        />
      ))}
    </div>
  );
}

export function cycleSegSegments(
  pass: number,
  fail: number,
  blocked: number,
  ne: number,
  na: number,
  total: number,
  dimOpacity = 1,
): SegSegment[] {
  const base = total || 1;
  return [
    { widthPct: (pass / base) * 100, color: displayResultColor('PASS'), opacity: dimOpacity },
    { widthPct: (blocked / base) * 100, color: displayResultColor('BLOCKED'), opacity: dimOpacity },
    { widthPct: (fail / base) * 100, color: displayResultColor('FAIL'), opacity: dimOpacity },
    { widthPct: (ne / base) * 100, color: displayResultColor('NE'), opacity: dimOpacity },
    { widthPct: (na / base) * 100, color: displayResultColor('NA'), opacity: dimOpacity },
  ];
}

export function testerSegSegments(
  pass: number,
  fail: number,
  blocked: number,
  na: number,
  executed: number,
): SegSegment[] {
  const base = executed || 1;
  return [
    { widthPct: (pass / base) * 100, color: displayResultColor('PASS') },
    { widthPct: (blocked / base) * 100, color: displayResultColor('BLOCKED') },
    { widthPct: (fail / base) * 100, color: displayResultColor('FAIL') },
    { widthPct: (na / base) * 100, color: displayResultColor('NA') },
  ];
}

export function HorizBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-[13px] bg-qa-track w-full">
      <div style={{ width: `${Math.min(100, pct)}%`, background: color, height: '100%' }} />
    </div>
  );
}
