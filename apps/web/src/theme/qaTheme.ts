export const QA = {
  accent: '#15605E',
  bg: '#F5F3ED',
  bgOuter: '#EDEAE2',
  ink: '#1C1B18',
  muted: '#78736A',
  mutedLight: '#9c978c',
  mutedPale: '#b3aea3',
  border: '#e2ded4',
  borderMid: '#d8d3c7',
  borderLight: '#efece4',
  track: '#f0ede5',
  white: '#fff',
  PASS: '#2F7D5A',
  FAIL: '#C24533',
  BLOCKED: '#C2891E',
  NE: '#B3AEA3',
  NA: '#6E89A6',
} as const;

export type KpiStyle = 'editorial' | 'framed' | 'minimal';

export type QaTab = 'overview' | 'testers' | 'cycles' | 'trace' | 'uat' | 'wonder-miles' | 'ai' | 'import' | 'settings' | `project:${string}`;

export function displayResultColor(code: string): string {
  const map: Record<string, string> = {
    PASS: QA.PASS,
    FAIL: QA.FAIL,
    BLOCKED: QA.BLOCKED,
    NE: QA.NE,
    NA: QA.NA,
  };
  return map[code] || QA.mutedPale;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function passRateColor(pct: number): string {
  if (pct >= 85) return '#2f6a48';
  if (pct >= 60) return '#9a6a12';
  return '#a13d2c';
}

export function coverageColor(pct: number): string {
  if (pct >= 80) return '#2f6a48';
  if (pct >= 40) return '#9a6a12';
  return '#a13d2c';
}

export function softColor(hex: string): { bg: string; border: string; fg: string } {
  const m: Record<string, { bg: string; border: string; fg: string }> = {
    [QA.PASS]: { bg: '#eef4ef', border: '#cfe0d4', fg: '#2f6a48' },
    [QA.FAIL]: { bg: '#f8ece8', border: '#ecccc2', fg: '#a13d2c' },
    [QA.BLOCKED]: { bg: '#f8f1de', border: '#e8d6a8', fg: '#8f6312' },
    [QA.NA]: { bg: '#eaf0f6', border: '#c8d6e6', fg: '#345d87' },
    [QA.accent]: { bg: '#e7f1f0', border: '#c4ddda', fg: '#0f4d4b' },
  };
  return m[hex] || { bg: '#f3f5f4', border: '#d9e0dd', fg: hex };
}

export interface BadgeStyle {
  label: string;
  fg: string;
  bg: string;
}

export function cycleBadge(status: string): BadgeStyle {
  if (status === 'Not Started') return { label: status, fg: '#6b6660', bg: '#ececec' };
  if (status === 'Healthy') return { label: status, fg: '#2f6a48', bg: '#e7f0e9' };
  if (status === 'In Progress') return { label: status, fg: '#9a6a12', bg: '#f6efd9' };
  if (status === 'Watch') return { label: status, fg: '#9a6a12', bg: '#f6efd9' };
  if (status === 'At Risk') return { label: status, fg: '#a13d2c', bg: '#f6e4df' };
  return { label: status, fg: QA.muted, bg: '#ececec' };
}

export function traceBadge(status: string): BadgeStyle {
  if (status === 'Verified') return { label: status, fg: '#2f6a48', bg: '#e7f0e9' };
  if (status === 'In Progress') return { label: status, fg: '#9a6a12', bg: '#f6efd9' };
  if (status === 'At Risk') return { label: status, fg: '#a13d2c', bg: '#f6e4df' };
  return cycleBadge(status);
}

export const PRIORITY_COLORS: Record<string, string> = {
  Highest: '#C24533',
  High: '#C2891E',
  Medium: '#6E89A6',
  Low: '#B3AEA3',
  Urgent: '#C24533',
};
