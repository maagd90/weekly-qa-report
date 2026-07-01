/** Strip the ## Summary heading — UI renders its own section label */
export function summaryBodyOnly(markdown: string): string {
  return markdown.replace(/^#+\s*Summary\s*\n?/i, '').trim();
}

export function trimSummaryForPrint(markdown: string, maxBullets = 5): string {
  const body = summaryBodyOnly(markdown);
  const bullets = body.split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l));
  if (bullets.length >= 2) {
    return bullets.slice(0, maxBullets).join('\n');
  }
  return body;
}
