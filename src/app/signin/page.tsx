import { inviteRequired } from "@/lib/signup-policy";

import { SignInForm } from "./sign-in-form";

/**
 * Sign in / sign up.
 *
 * A server component purely so `INVITE_CODE` is read on the server. Whether a
 * code is required is a deployment fact, not a user preference, and the client
 * only ever learns the boolean.
 *
 * `force-dynamic` because the env is read here: statically prerendered, the
 * answer would be baked in at build time, and blanking INVITE_CODE in a
 * dashboard would leave the form still asking for a code it no longer needs.
 *
 * Unset means open signup. That is a deliberate switch rather than an
 * oversight: the expensive work in this app -- Wikipedia hydration and the
 * Gemini call -- is paid **once per book, globally**, so a second reader of a
 * book costs nothing at all. What does scale with people is the number of
 * *first* readers walking into unopened books, which is why the signup rate
 * limit and MAX_ACCOUNTS in src/lib/auth.ts stay in place either way.
 */
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return <SignInForm inviteRequired={inviteRequired()} />;
}
