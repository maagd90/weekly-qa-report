export async function waitForChartPaint(reportType: string): Promise<void> {
  const needsCharts = reportType !== 'testers';
  if (needsCharts) {
    const deadline = Date.now() + 5000;
    const chartSelector = '.qa-print-page svg, .qa-print-page [data-testid="vendor-portal-phase-chart"]';
    while (document.querySelectorAll(chartSelector).length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
}
