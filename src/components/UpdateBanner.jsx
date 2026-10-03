import { useUpdateAvailable } from '../lib/update.js';

// Offered, never forced: reloading in the middle of a test would lose it.
export default function UpdateBanner() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version is ready.</span>
      <button className="primary small-btn" onClick={() => location.reload()}>Update</button>
    </div>
  );
}
