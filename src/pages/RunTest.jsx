import { TESTS, testById } from '../tests/registry.js';

// Pick who to test, then which test, then run it.
// people: [{ uid, name }] the viewer may test. selfUid: the viewer if they're
// an athlete (null for the coach). pick/setPick persist across reloads.
export default function RunTest({ people, selfUid, isCoach, pick, setPick }) {
  const subject = people.find((p) => p.uid === pick.subjectUid);
  const test = pick.testId && testById[pick.testId];

  if (!subject) {
    return (
      <section className="run">
        <h2>Who are you testing?</h2>
        {people.length === 0 && (
          <div className="callout">No athletes on the team yet. Share the team code from the Team tab.</div>
        )}
        <div className="people">
          {people.map((p) => (
            <button key={p.uid} className="person" onClick={() => setPick({ subjectUid: p.uid, testId: null })}>
              <b>{p.uid === selfUid ? 'Me' : p.name}</b>
              {p.uid === selfUid && <span className="muted small">{p.name}</span>}
            </button>
          ))}
        </div>
        {!isCoach && (
          <p className="muted small">
            Testing a teammate is for post-hit checks: you’ll see what to do, but not their numbers.
          </p>
        )}
      </section>
    );
  }

  const isSelf = subject.uid === selfUid;

  if (!test) {
    return (
      <section className="run">
        <button className="ghost small-btn" onClick={() => setPick({ subjectUid: null, testId: null })}>
          ← Change person
        </button>
        <h2>{isSelf ? 'Test yourself' : `Test ${subject.name}`}</h2>
        <div className="test-pick">
          {TESTS.map((t) => (
            <button key={t.id} className="test-option" onClick={() => setPick({ ...pick, testId: t.id })}>
              <b>{t.label}</b>
              <span className="muted small">{t.measures}</span>
              <span className="muted small">{t.time} · {t.device}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="run">
      <div className="row run-crumbs">
        <button className="ghost small-btn" onClick={() => setPick({ ...pick, testId: null })}>
          ← Change test
        </button>
        <span className="muted small">
          Testing <b>{isSelf ? 'yourself' : subject.name}</b>
        </span>
      </div>
      <test.Component
        key={`${subject.uid}:${test.id}`}
        subject={subject}
        isSelf={isSelf}
        canSeeData={isSelf || isCoach}
      />
    </section>
  );
}
