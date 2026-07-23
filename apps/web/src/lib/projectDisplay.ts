import { canonicalProjectKey } from './projectKeys';

const PROJECT_DISPLAY_NAMES: Record<string, string> = {};

PROJECT_DISPLAY_NAMES.DLM = 'DN4_FT - Supply & DMC';
PROJECT_DISPLAY_NAMES.DP = 'WonderMiles';

export function projectDisplayName(project?: string | null, namesByKey?: Record<string, string>): string {
  const code = canonicalProjectKey(project);
  if (!code || code === 'all') return 'All projects';
  const configured = Object.entries(namesByKey || {})
    .find(([key]) => canonicalProjectKey(key) === code)?.[1]?.trim();
  if (configured) return configured;
  return PROJECT_DISPLAY_NAMES[code] || code;
}

export function projectDisplayWithCode(project?: string | null, namesByKey?: Record<string, string>): string {
  const code = canonicalProjectKey(project);
  if (!code || code === 'all') return 'All projects';
  const label = projectDisplayName(code, namesByKey);
  return label === code ? code : `${label} (${code})`;
}
