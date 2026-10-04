// Baseline keeps its existing home and invite URLs. The shop is a separate,
// public page; choosing it must happen before loading the health app.
export function pageForPath(pathname) {
  return pathname === '/merch' || pathname === '/merch/' ? 'merch' : 'app';
}
