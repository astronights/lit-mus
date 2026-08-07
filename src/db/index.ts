import { createRequire } from "node:module";

import { neon } from "@neondatabase/serverless";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";

import { requireEnv } from "@/lib/load-env";

import * as schema from "./schema";

// `requireEnv` loads .env.local / .env first, so this works whether it is
// reached through Next.js (which loads them anyway) or a CLI script.
const connectionString: string = requireEnv("DATABASE_URL");

/**
 * Neon's serverless HTTP driver in production: every query is a fetch, so
 * there is no connection pool to keep warm across invocations -- which is the
 * thing ordinary Postgres pooling gets wrong inside serverless functions.
 *
 * A `localhost` URL falls back to node-postgres so the app, the seed job and
 * the migrations can run against a local Postgres with no Neon account. The
 * require is deliberately opaque to the bundler: `pg` is a devDependency and
 * must not end up in the deployed bundle.
 */
function isLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function createDb(): NeonHttpDatabase<typeof schema> {
  if (!isLocal(connectionString)) {
    return drizzleNeon(neon(connectionString), { schema });
  }

  const require = createRequire(import.meta.url);
  let Pool: new (config: { connectionString: string }) => unknown;
  try {
    ({ Pool } = require("pg"));
  } catch {
    throw new Error(
      "DATABASE_URL points at localhost, which needs the `pg` driver: npm i -D pg",
    );
  }

  const { drizzle: drizzleNode } = require("drizzle-orm/node-postgres");
  return drizzleNode(new Pool({ connectionString: connectionString }), {
    schema,
  }) as NeonHttpDatabase<typeof schema>;
}

export const db = createDb();

export { schema };
