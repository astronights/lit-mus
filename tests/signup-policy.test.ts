import { afterEach, describe, expect, it } from "vitest";

import { accountCeiling, inviteRequired } from "@/lib/signup-policy";

/**
 * These two decisions are read from two places each -- the sign-in form and the
 * auth hook -- and they have to agree. A drift means the form hides a field the
 * server still demands, and signup fails with nothing on screen to explain it.
 */

const original = { invite: process.env.INVITE_CODE, max: process.env.MAX_ACCOUNTS };

afterEach(() => {
  process.env.INVITE_CODE = original.invite;
  process.env.MAX_ACCOUNTS = original.max;
});

describe("inviteRequired", () => {
  it("is off when unset — open signup is a setting, not a mistake", () => {
    delete process.env.INVITE_CODE;
    expect(inviteRequired()).toBe(false);
  });

  it("is off for an empty or whitespace value", () => {
    // The likeliest way to open signup is blanking the value in a dashboard,
    // which leaves "" — and on some it leaves " ".
    for (const value of ["", "   ", "\t"]) {
      process.env.INVITE_CODE = value;
      expect(inviteRequired(), JSON.stringify(value)).toBe(false);
    }
  });

  it("is on for a real code", () => {
    process.env.INVITE_CODE = "open-sesame";
    expect(inviteRequired()).toBe(true);
  });
});

describe("accountCeiling", () => {
  it("is absent when unset", () => {
    delete process.env.MAX_ACCOUNTS;
    expect(accountCeiling()).toBeNull();
  });

  it("reads a positive integer", () => {
    process.env.MAX_ACCOUNTS = "25";
    expect(accountCeiling()).toBe(25);
  });

  it("treats junk and non-positive values as no ceiling", () => {
    // Not as a ceiling of zero: a typo must not lock everyone out of signup.
    for (const value of ["", "0", "-5", "lots", "NaN"]) {
      process.env.MAX_ACCOUNTS = value;
      expect(accountCeiling(), value).toBeNull();
    }
  });
});
