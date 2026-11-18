import { useEffect, useState } from 'react';
import { gnssState, onGnss, type GnssState } from './gnss';

export function useGnss(): GnssState {
  const [s, setS] = useState<GnssState>(gnssState());
  useEffect(() => onGnss(setS), []);
  return s;
}
