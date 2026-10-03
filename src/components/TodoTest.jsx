// Placeholder shown for tests that aren't built yet.
export default function TodoTest({ title, description, spec }) {
  return (
    <section className="test">
      <header className="test-head">
        <h2>{title}</h2>
        <p className="muted">{description}</p>
      </header>
      <div className="callout">
        <b>Not built yet.</b> Planned metrics:
        <ul>
          {spec.map((m) => <li key={m}>{m}</li>)}
        </ul>
        See "Adding a test" in the README for how it plugs into baselines.
      </div>
    </section>
  );
}
