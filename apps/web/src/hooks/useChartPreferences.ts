import { useState, useEffect } from 'react';
import { CHART_IDS, DEFAULT_CHART_PREFERENCES, type ChartId } from '../lib/api';

const STORAGE_KEY = 'chartPreferences';

function loadPrefs(): Record<ChartId, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CHART_PREFERENCES, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CHART_PREFERENCES };
}

export function useChartPreferences() {
  const [prefs, setPrefsState] = useState(loadPrefs);

  useEffect(() => {
    const handler = () => setPrefsState(loadPrefs());
    window.addEventListener('chart-prefs-changed', handler);
    return () => window.removeEventListener('chart-prefs-changed', handler);
  }, []);

  const setPref = (id: ChartId, visible: boolean) => {
    const next = { ...loadPrefs(), [id]: visible };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setPrefsState(next);
  };

  return { prefs, setPref, chartIds: CHART_IDS };
}
