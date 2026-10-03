// Keep infrastructure failures distinct from invalid team codes or form input.
export function serviceErrorMessage(error, fallback = 'Something went wrong. Try again.') {
  const code = String(error?.code ?? '').replace(/^firestore\//, '');
  const message = typeof error === 'string' ? error : error?.message ?? '';
  if (error?.name === 'QuotaExceededError') {
    return 'This browser is out of storage space. Free up space before recording more results.';
  }
  if (code === 'resource-exhausted' || /quota (?:has been )?exceeded|resource.exhausted/i.test(message)) {
    return 'Firebase has reached its usage limit. Team changes and cloud sync need the project’s service to become available again.';
  }
  if (code === 'permission-denied') {
    return 'This account does not have permission to complete that action. Check that you are signed in to the correct account and team.';
  }
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'network-request-failed') {
    return 'Can’t reach the server. Check your connection and retry when you’re online.';
  }
  if (code === 'unauthenticated') {
    return 'Your sign-in has expired. Sign in again to continue.';
  }
  return message || fallback;
}
