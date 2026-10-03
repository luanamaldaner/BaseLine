import { useLayoutEffect } from 'react';

// While a test is actually running, mark the page so the layout can give the
// test the whole screen (see .test-running in styles.css).
export function useTestRunning(active) {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const root = document.documentElement;
    root.classList.add('test-running');
    scrollToTop();
    return () => root.classList.remove('test-running');
  }, [active]);
}

function scrollToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

// Reset after the new screen is committed, before it is painted.
export function useScreenTop(identity) {
  useLayoutEffect(scrollToTop, [identity]);
}
