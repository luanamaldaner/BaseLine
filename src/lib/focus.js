import { useEffect } from 'react';

// While a test is actually running, mark the page so the layout can give the
// test the whole screen (see .test-running in styles.css).
export function useTestRunning(active) {
  useEffect(() => {
    if (!active) return undefined;
    const root = document.documentElement;
    root.classList.add('test-running');
    return () => root.classList.remove('test-running');
  }, [active]);
}
