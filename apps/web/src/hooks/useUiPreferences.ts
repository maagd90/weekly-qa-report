import { useState } from 'react';
import type { KpiStyle } from '../theme/qaTheme';

export function useUiPreferences() {
  const [kpiStyle, setKpiStyle] = useState<KpiStyle>('editorial');
  const [selectedCycle, setSelectedCycle] = useState<string | null>(null);

  return {
    kpiStyle,
    setKpiStyle,
    selectedCycle,
    setSelectedCycle,
    clearSelectedCycle: () => setSelectedCycle(null),
  };
}
