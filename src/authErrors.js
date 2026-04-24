/**
 * Map Firebase Auth error codes to user-friendly copy.
 * Returns a generic fallback for unmapped codes. Raw err should still be
 * logged via the existing logger so debugging doesn't regress.
 */
const AUTH_ERROR_COPY = {
  'auth/wrong-password': 'Wrong email or password.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/email-already-in-use': 'That email is already registered. Try signing in.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/invalid-email': "That doesn't look like a valid email.",
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes.',
  'auth/network-request-failed': "Can't reach the server. Check your connection.",
  'auth/user-disabled': 'This account has been disabled.',
  'auth/expired-action-code': 'This reset link has expired. Request a new password reset email.',
  'auth/invalid-action-code': 'This reset link is invalid or was already used. Request a new password reset email.',
};

export function humanizeAuthError(err) {
  if (!err) return 'Something went wrong. Please try again.';
  if (err.code && AUTH_ERROR_COPY[err.code]) return AUTH_ERROR_COPY[err.code];
  // Plain Errors thrown by our own validation code (no Firebase error code) carry a human message.
  if (!err.code && err.message) return err.message;
  // Firebase RTDB permission errors surface as strings like "PERMISSION_DENIED: Permission denied"
  if (err.message && err.message.includes('PERMISSION_DENIED')) return 'Permission denied. Please try again or contact support.';
  return 'Something went wrong. Please try again.';
}
