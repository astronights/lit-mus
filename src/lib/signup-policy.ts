/**
 * Who is allowed to create an account, read from the environment.
 *
 * Kept apart from `@/lib/auth` because that module imports the database, and
 * this needs to be readable from a server component and testable without a
 * DATABASE_URL.
 *
 * It also has to be read in two places -- the sign-in form decides whether to
 * show the invite field, the auth hook decides whether to demand one -- and
 * those two must agree. If they drift, the form hides a field the server still
 * requires and signup fails with no visible cause. One function, called twice.
 */

/**
 * An unset or blank `INVITE_CODE` means open signup.
 *
 * This is a supported configuration rather than a misconfiguration, and it used
 * to throw. The cost model is what makes it defensible: Wikipedia hydration and
 * the Gemini call are paid once per *book*, globally, so the second reader of a
 * book costs nothing and the hundredth costs nothing. More readers do not
 * multiply the API spend; they reach the unopened books sooner.
 */
export function inviteRequired(): boolean {
  return Boolean(process.env.INVITE_CODE?.trim());
}

/**
 * Hard ceiling on accounts, or null for none.
 *
 * Unset is right while the invite code is doing the gatekeeping. With an open
 * form it is the only thing between a public URL and however many rows a script
 * cares to make -- the per-IP signup limit slows that down, it does not stop it.
 */
export function accountCeiling(): number | null {
  const configured = Number(process.env.MAX_ACCOUNTS);
  return Number.isFinite(configured) && configured > 0 ? configured : null;
}
