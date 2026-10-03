import { useScreenTop } from '../lib/focus.js';
import { TESTS, testById } from '../tests/registry.js';
import Flow from './Flow.jsx';
import { TestBadge } from '../components/Icons.jsx';
import Avatar from '../components/Avatar.jsx';

// The one bar shown on a test screen (the app header and tabs are hidden).
function TestBar({ title, who, onBack }) {
  return (
    <div className="test-bar">
      <button className="ghost small-btn" onClick={onBack}>← Back</button>
      <div className="test-bar-title">
        <b>{title}</b>
        <span className="muted small">{who}</span>
      </div>
    </div>
  );
}

// Pick who to test, then which test, then run it.
// people: [{ uid, name }] the viewer may test. selfUid: the viewer if they're
// an athlete (null for the coach). pick/setPick persist across reloads.
export default function RunTest({ people, selfUid, isCoach, pick, setPick }) {
  useScreenTop(`${pick.subjectUid}:${pick.testId}`);
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
              <Avatar name={p.name} />
              <span className="person-text">
                <b>{p.uid === selfUid ? 'Me' : p.name}</b>
                {p.uid === selfUid && <span className="muted small">{p.name}</span>}
              </span>
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

  // All three objective tests, one after the other, with spoken instructions.
  if (pick.testId === 'all') {
    return (
      <section className="run">
        <TestBar
          title="All three tests"
          who={isSelf ? 'Testing yourself' : `Testing ${subject.name}`}
          onBack={() => setPick({ ...pick, testId: null })}
        />
        <Flow
          key={subject.uid}
          subject={subject}
          isSelf={isSelf}
          canSeeData={isSelf || isCoach}
          onDone={() => setPick({ ...pick, testId: null })}
        />
      </section>
    );
  }

  if (!test) {
    return (
      <section className="run">
        <button className="ghost small-btn" onClick={() => setPick({ subjectUid: null, testId: null })}>
          ← Change person
        </button>
        <div className="run-start">
          <Avatar name={subject.name} />
          <h2>{isSelf ? 'Test yourself' : `Test ${subject.name}`}</h2>
        </div>
        <div className="test-pick">
          <button className="test-option all" onClick={() => setPick({ ...pick, testId: 'all' })}>
            <span className="all-badges" aria-hidden>
              {TESTS.map((t) => <TestBadge key={t.id} id={t.id} size={36} />)}
            </span>
            <b>All three, one after the other</b>
            <span className="muted small">Reaction, then eyes, then balance. Spoken instructions, one save at the end.</span>
            <span className="muted small">4 min · Phone</span>
          </button>
          {TESTS.map((t) => (
            <button key={t.id} className="test-option" onClick={() => setPick({ ...pick, testId: t.id })}>
              <TestBadge id={t.id} />
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
      <TestBar
        title={test.label}
        who={isSelf ? 'Testing yourself' : `Testing ${subject.name}`}
        onBack={() => setPick({ ...pick, testId: null })}
      />
      <test.Component
        key={`${subject.uid}:${test.id}`}
        subject={subject}
        isSelf={isSelf}
        canSeeData={isSelf || isCoach}
      />
    </section>
  );
}
