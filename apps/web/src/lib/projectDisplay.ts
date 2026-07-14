import { canonicalProjectKey } from './projectKey';

const PROJECT_DISPLAY_NAMES: Record<string, string> = {};

PROJECT_DISPLAY_NAMES.DLM = 'DN4_FT - Supply & DMC';
PROJECT_DISPLAY_NAMES.DP = 'WonderMiles';

export function projectDisplayName(project?: string | null): string {
  const code = canonicalProjectKey(project);
  if (!code || code === 'all') return 'All projects';
  return PROJECT_DISPLAY_NAMES[code] || code;
}

export function projectDisplayWithCode(project?: string | null): string {
  const code = canonicalProjectKey(project);
  if (!code || code === 'all') return 'All projects';
  const label = projectDisplayName(code);
  return label === code ? code : `${label} (${code})`;
}
