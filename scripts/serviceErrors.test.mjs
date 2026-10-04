import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceErrorMessage } from '../src/lib/serviceErrors.js';

test('service quota is explained without blaming the team code or connectivity', () => {
  for (const error of [{ code: 'resource-exhausted' }, { code: 'firestore/resource-exhausted' }, { message: 'Quota exceeded.' }]) {
    const text = serviceErrorMessage(error);
    assert.match(text, /usage limit/i);
    assert.doesNotMatch(text, /code didn.t work|check your connection/i);
  }
});

test('browser storage quota stays distinct from Firebase service quota', () => {
  const text = serviceErrorMessage({ name: 'QuotaExceededError', message: 'Quota exceeded.' });
  assert.match(text, /browser.*storage space/i);
  assert.doesNotMatch(text, /Firebase/);
});

test('permission and connection failures have different recovery guidance', () => {
  assert.match(serviceErrorMessage({ code: 'permission-denied' }), /correct account and team/);
  assert.match(serviceErrorMessage({ code: 'PERMISSION_DENIED' }), /correct account and team/);
  assert.match(serviceErrorMessage({ code: 'unavailable' }), /connection/);
  assert.match(serviceErrorMessage({ code: 'unauthenticated' }), /Sign in again/);
});

test('validation messages and caller fallbacks are retained', () => {
  assert.equal(serviceErrorMessage(new Error('No team with that code.')), 'No team with that code.');
  assert.equal(serviceErrorMessage('Custom failure'), 'Custom failure');
  assert.equal(serviceErrorMessage(null, 'Could not save.'), 'Could not save.');
});
