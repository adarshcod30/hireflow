import { useEffect, useState } from 'react';

/** The current time, refreshed on an interval, so "2 minutes ago" labels keep moving on their own. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
