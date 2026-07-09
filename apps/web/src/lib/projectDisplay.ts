export function projectDisplayName(project?: string | null): string {
  const code = (project || '').trim();
  if (!code || code === 'all') return 'All projects';
  return code;
}

export function projectDisplayWithCode(project?: string | null): string {
  return projectDisplayName(project);
}
