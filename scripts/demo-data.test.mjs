import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoData } from './demo-data.mjs';
import { SPECS, TEST_IDS, compareToSummary, summarize, limitsFrom, judge } from '../shared/assess.js';

const options = {
  uids: Object.fromEntries(['coach', 'healthy', 'monitor', 'refer', 'newcomer'].map((role) => [role, `demo-${role}-20261003`])),
  teamId: 'demo-falcons-20261003', code: 'DEMO26', referenceAt: '2026-10-04T02:00:00.000Z',
};

test('fictional dataset is deterministic, scoped to demo accounts, and does not fabricate consent', () => {
  const { data, metadata } = buildDemoData(options);
  assert.deepEqual(buildDemoData(options), { data, metadata });
  assert.equal(metadata.trials, 89);
  assert.equal(metadata.baselines, 52);
  assert.equal(metadata.checks, 37);
  assert.equal(metadata.fictional, true);
  for (const [uid, profile] of Object.entries(data.profiles)) {
    assert.ok(Object.values(options.uids).includes(uid));
    assert.match(profile.name, /\(DEMO\)$/);
    assert.equal(Object.hasOwn(profile, 'consentedAt'), false);
    assert.deepEqual(profile.teamIds, { [options.teamId]: true });
  }
  for (const [uid, readers] of Object.entries(data.recordReaders)) {
    assert.notEqual(uid, options.uids.coach);
    assert.deepEqual(readers, { [options.uids.coach]: { [options.teamId]: true } });
  }
});

test('every check matches the app comparison using prior baselines and separate device ranges', () => {
  const { data, metadata } = buildDemoData(options);
  for (const [uid, records] of Object.entries(data.trials)) {
    const trials = Object.values(records);
    for (const trial of trials) {
      assert.ok(Date.parse(trial.at) <= Date.parse(options.referenceAt));
      assert.ok(Object.values(trial.metrics).every(Number.isFinite));
      assert.equal(trial.subjectUid, uid);
      if (trial.kind === 'baseline') {
        assert.equal(trial.testerUid, uid);
        assert.equal(Object.hasOwn(trial, 'status'), false);
        assert.equal(Object.hasOwn(trial, 'teamId'), false);
        continue;
      }
      const summary = summarize(trials.filter((baseline) => baseline.kind === 'baseline' && baseline.test === trial.test && baseline.at < trial.at));
      const range = limitsFrom(summary, SPECS[trial.test]);
      assert.equal(trial.status, judge(range, trial.metrics));
      assert.equal(trial.status, compareToSummary(summary, trial.metrics, SPECS[trial.test]).status);
      assert.equal(trial.teamId, options.teamId);
      assert.equal(trial.testerUid, options.uids.coach);
    }
    const ranges = data.ranges[options.teamId];
    for (const testId of TEST_IDS) {
      const baselines = trials.filter((trial) => trial.kind === 'baseline' && trial.test === testId);
      const range = limitsFrom(summarize(baselines), SPECS[testId]);
      assert.deepEqual(ranges[`${uid}_${testId}`], range ? { subjectUid: uid, test: testId, ...range } : undefined);
    }
  }
  assert.deepEqual(metadata.scenarios.healthy.latestStatusByTest, { balance: 'normal', reaction: 'normal', eye: 'normal', eyePhone: 'normal' });
  assert.deepEqual(metadata.scenarios.monitor.latestStatusByTest, { balance: 'normal', reaction: 'monitor', eye: 'normal', eyePhone: 'normal' });
  assert.deepEqual(metadata.scenarios.refer.latestStatusByTest, { balance: 'normal', reaction: 'refer', eye: 'normal', eyePhone: 'normal' });
  assert.deepEqual(metadata.scenarios.newcomer.latestStatusByTest, { eyePhone: 'no-baseline' });
  assert.notDeepEqual(data.ranges[options.teamId][`${options.uids.healthy}_eye`], data.ranges[options.teamId][`${options.uids.healthy}_eyePhone`]);
});

test('newcomer has only partial baseline progress and no made-up eye cutoff', () => {
  const { data } = buildDemoData(options);
  const trials = Object.values(data.trials[options.uids.newcomer]);
  for (const testId of ['balance', 'reaction']) assert.equal(trials.filter((trial) => trial.test === testId && trial.kind === 'baseline').length, 2);
  assert.equal(trials.filter((trial) => ['eye', 'eyePhone'].includes(trial.test) && trial.kind === 'baseline').length, 0);
  assert.equal(trials.find((trial) => trial.kind === 'check').status, 'no-baseline');
});

test('reject duplicate account IDs, unsafe database paths, and missing reference time', () => {
  assert.throws(() => buildDemoData({ ...options, uids: { ...options.uids, monitor: options.uids.healthy } }), /distinct/);
  assert.throws(() => buildDemoData({ ...options, teamId: 'teams/real-team' }), /valid demo team/);
  assert.throws(() => buildDemoData({ ...options, code: 'demo' }), /six-character/);
  assert.throws(() => buildDemoData({ ...options, referenceAt: undefined }), /UTC reference/);
});
