import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Open Library serves every cover we display.
      { protocol: "https", hostname: "covers.openlibrary.org" },
    ],
  },
  serverExternalPackages: ["@node-rs/argon2"],
  // The prompt and the file-driven seed list are read from disk at runtime,
  // and Next's tracer cannot follow a dynamic readFileSync path -- without
  // this they are missing from the deployed bundle.
  outputFileTracingIncludes: {
    /*
     * The prompt goes into *every* function, not the one that happens to
     * generate today.
     *
     * It is read from disk at runtime and Next cannot trace a dynamic
     * readFileSync path, so this list is the only thing putting it in the
     * bundle. Naming a single route meant that moving generation from the book
     * route to the drill route silently left the file behind: readFileSync
     * threw on every book, and the failure surfaced as "no questions" -- i.e.
     * as a claim about Wikipedia rather than about the deployment.
     *
     * A few KB in each function is a trivial price for that never recurring.
     */
    "/**": ["./prompts/**"],
    "/api/cron/seed": ["./data/**"],
  },
};

export default nextConfig;
