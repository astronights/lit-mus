import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { count } from "drizzle-orm";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { db } from "@/db";
import { account, session, user, verification } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { accountCeiling, inviteRequired } from "@/lib/signup-policy";

/**
 * Better Auth: email + password, argon2id, database-backed sessions.
 *
 * These routes must run on the Node runtime (see app/api/auth/[...all]/route.ts)
 * -- @node-rs/argon2 is a native module and will not load on Edge.
 */

const NINETY_DAYS = 60 * 60 * 24 * 90;

// @node-rs/argon2 exports `Algorithm` as an ambient const enum, which cannot
// be imported under `isolatedModules`. 2 is `Algorithm.Argon2id`.
const ARGON2ID = 2;

// OWASP's second recommended argon2id profile: 19 MiB, t=2, p=1. Comfortably
// inside a serverless function's memory while staying expensive to crack.
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,

  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 10,
    // Password reset is deliberately not built (Section 5d): it needs an email
    // service, and at friends-and-family scale a reset is a manual DB fix.
    password: {
      hash: (password) => argonHash(password, ARGON2_OPTIONS),
      verify: ({ hash, password }) => argonVerify(hash, password, ARGON2_OPTIONS),
    },
  },

  session: {
    expiresIn: NINETY_DAYS,
    // Slide the expiry when a session is used inside a day: sign in once per
    // device and forget it.
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  advanced: {
    cookiePrefix: "litmus",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },

  // Better Auth's own limiter covers per-IP. Per-email is layered on in the
  // before-hook below, so one attacker rotating IPs still can't grind a
  // single account.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = (ctx.body ?? {}) as Record<string, unknown>;

      if (ctx.path === "/sign-up/email") {
        /*
         * INVITE_CODE unset means open signup, and that is a supported
         * configuration rather than a misconfiguration.
         *
         * It used to throw. The reasoning was that a public URL with an open
         * form collects junk accounts -- still true -- but the cost model here
         * makes an open door cheap in the way that matters: hydration and the
         * Gemini call are paid once per *book*, globally, so the second person
         * to read a book costs nothing and the hundredth costs nothing. More
         * readers do not multiply the API spend; they only reach the unopened
         * books sooner.
         *
         * What is left to defend against is account spam, which is what the
         * per-IP signup limit above and the ceiling below are for.
         */
        if (inviteRequired()) {
          const supplied = typeof body.inviteCode === "string" ? body.inviteCode : "";
          if (!timingSafeEqual(supplied, process.env.INVITE_CODE!.trim())) {
            throw new APIError("FORBIDDEN", { message: "That invite code isn't right." });
          }
        }

        await enforceAccountCeiling();
      }

      if (ctx.path === "/sign-in/email") {
        const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
        if (email) {
          // 10 attempts per email per 15 minutes, independent of source IP.
          const result = await rateLimit(`signin:email:${email}`, 10, 15 * 60);
          if (!result.ok) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many sign-in attempts. Try again in a few minutes.",
            });
          }
        }
      }
    }),
  },
});

/**
 * Hard ceiling on accounts, so an open signup form cannot grow without bound.
 *
 * `MAX_ACCOUNTS` unset means no ceiling, which is right when INVITE_CODE is
 * doing the gatekeeping. With the code removed it is the only thing standing
 * between a public form and however many rows a script cares to make: the
 * per-IP limit slows that down, it does not stop it.
 *
 * A count on every signup is one cheap query on a table that will never be
 * large, and signup is rare by nature.
 */
async function enforceAccountCeiling(): Promise<void> {
  const ceiling = accountCeiling();
  if (ceiling === null) return;

  const [row] = await db.select({ total: count() }).from(user);
  if ((row?.total ?? 0) >= ceiling) {
    // Deliberately not "the app is full of spam": the honest reading for a
    // real person hitting this is that signups are closed.
    throw new APIError("FORBIDDEN", {
      message: "Signups are closed for now — this deployment is at its account limit.",
    });
  }
}

/**
 * Constant-time string comparison. Length is not secret here (the invite code
 * length is effectively public), but the contents are.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  // Compare against a fixed-size buffer so the loop count doesn't vary with
  // the attacker-controlled input.
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}
