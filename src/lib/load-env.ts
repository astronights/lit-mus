import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "dotenv";

/**
 * Environment loading for everything that runs outside Next.js -- drizzle-kit
 * and the CLI scripts.
 *
 * Next.js reads `.env.local` itself; plain `dotenv` does not, it only reads
 * `.env`. Without this, `npm run db:push` and `npm run seed` silently ignore
 * the file the README tells you to create.
 *
 * Precedence matches Next.js: `.env.local` wins over `.env`, and a variable
 * already set in the real environment wins over both (so `DATABASE_URL=... npm
 * run seed` overrides the file).
 */

const FILES = [".env.local", ".env"];

let loaded = false;

export function loadEnv(cwd = process.cwd()): void {
  if (loaded) return;
  loaded = true;

  for (const file of FILES) {
    const absolute = path.join(cwd, file);
    if (!existsSync(absolute)) continue;

    for (const [key, value] of Object.entries(parse(readEnvFile(absolute)))) {
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

/**
 * Read an env file whatever its encoding.
 *
 * PowerShell's `>` redirect writes UTF-16LE, so `echo 'X=y' > .env.local` on
 * Windows produces a file `dotenv` parses as garbage -- and the resulting
 * error ("connection url required") points at the config, not at the file.
 * Decoding by BOM costs three lines and removes the trap entirely.
 */
function readEnvFile(absolute: string): string {
  const buffer = readFileSync(absolute);

  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return Buffer.from(buffer.subarray(2)).swap16().toString("utf16le");
  }
  // Strip a UTF-8 BOM, which Notepad and `Set-Content -Encoding utf8` add.
  return buffer.toString("utf8").replace(/^﻿/, "");
}

/** Fail with a message that says what to fix, not just what was missing. */
export function requireEnv(name: string): string {
  loadEnv();
  const value = process.env[name];
  if (value) return value;

  const found = FILES.filter((file) => existsSync(path.join(process.cwd(), file)));
  throw new Error(
    `${name} is not set.\n` +
      (found.length > 0
        ? `Checked ${found.join(" and ")} — the file exists but has no ${name} line.\n`
        : `No .env.local or .env found in ${process.cwd()}.\n`) +
      `Create .env.local with:\n  ${name}="..."\n` +
      `On Windows PowerShell use Set-Content, not > — the latter writes UTF-16:\n` +
      `  Set-Content -Path .env.local -Value '${name}="..."' -Encoding utf8`,
  );
}
