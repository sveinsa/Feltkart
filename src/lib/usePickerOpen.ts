import { useEffect, useState } from 'react';
import { onPickerChange } from './google';

/** true mens Googles mappe-/filvelger er åpen. Dialogen skjuler seg da, slik at velgeren ikke havner bak. */
export function usePickerOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => onPickerChange(setOpen), []);
  return open;
}
