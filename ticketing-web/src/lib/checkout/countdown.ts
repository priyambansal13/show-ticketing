'use client';

import { useEffect, useState } from 'react';

/** Whole seconds left until `deadline` (ISO), ticking once a second; 0 once passed. */
export function useSecondsLeft(deadline: string | null | undefined): number | null {
  const target = deadline ? Date.parse(deadline) : null;
  const compute = () => (target === null ? null : Math.max(0, Math.ceil((target - Date.now()) / 1000)));
  const [seconds, setSeconds] = useState<number | null>(compute);
  useEffect(() => {
    if (target === null) return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target]);
  return seconds;
}

export const formatClock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Screen-reader announcement only at these thresholds (WCAG 2.2.1), never every second. */
export function countdownAnnouncement(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds === 0) return 'Your seat hold has expired.';
  if (seconds <= 10) return 'Less than 10 seconds left to complete payment.';
  if (seconds <= 60) return 'Less than one minute left to complete payment.';
  return '';
}
