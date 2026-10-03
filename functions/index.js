// recordCheck: saves a post-hit check for a teammate and returns the call.
//
// The tester may not read the teammate's baseline, so the comparison has to
// happen here. Everyone gets the status and what to do; only the athlete
// themselves and the coach get the numbers back.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  SPECS, METRIC_KEYS, TEST_IDS, ACTIONS, summarize, compareToSummary,
} from './shared/assess.js';

initializeApp();
const db = getFirestore();

const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s);

function cleanMetrics(test, metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  const keys = METRIC_KEYS[test];
  const given = Object.keys(metrics);
  if (given.length !== keys.length || !keys.every((k) => given.includes(k))) return null;
  const out = {};
  for (const k of keys) {
    const v = metrics[k];
    if (v === null) out[k] = null;
    else if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6) out[k] = v;
    else return null;
  }
  return out;
}

export const recordCheck = onCall({ region: 'us-east1' }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Log in first.');

  const { teamId, subjectUid, test } = req.data ?? {};
  if (!isId(teamId) || !isId(subjectUid) || !TEST_IDS.includes(test)) {
    throw new HttpsError('invalid-argument', 'Bad request.');
  }
  const metrics = cleanMetrics(test, req.data.metrics);
  if (!metrics) throw new HttpsError('invalid-argument', 'Test results are missing or malformed.');

  const teamRef = db.doc(`teams/${teamId}`);
  const [team, caller, subject] = await Promise.all([
    teamRef.get(),
    teamRef.collection('members').doc(uid).get(),
    teamRef.collection('members').doc(subjectUid).get(),
  ]);
  if (!team.exists) throw new HttpsError('not-found', 'Team not found.');
  const isCoach = team.get('coachUid') === uid;
  if (!isCoach && !caller.exists) throw new HttpsError('permission-denied', 'You are not on this team.');
  if (!subject.exists) throw new HttpsError('not-found', 'That athlete is not on this team.');

  const trials = await teamRef.collection('trials').where('subjectUid', '==', subjectUid).get();
  const baselines = trials.docs
    .map((d) => d.data())
    .filter((t) => t.test === test && t.kind === 'baseline');
  const comparison = compareToSummary(summarize(baselines), metrics, SPECS[test]);

  const ref = await teamRef.collection('trials').add({
    subjectUid,
    test,
    kind: 'check',
    at: new Date().toISOString(),
    metrics,
    testerUid: uid,
    status: comparison.status,
  });

  const canSeeData = isCoach || uid === subjectUid;
  return {
    id: ref.id,
    status: comparison.status,
    ...ACTIONS[comparison.status],
    baselineTrials: comparison.baselineTrials,
    ...(canSeeData ? { comparison } : {}),
  };
});
