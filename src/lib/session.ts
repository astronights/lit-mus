import { headers } from "next/headers";

import { auth } from "@/lib/auth";

export type CurrentUser = { id: string; email: string; name: string | null };

/** Resolve the signed-in user from the session cookie, or null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result?.user) return null;
  return {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name ?? null,
  };
}

/** For API routes: the 401 body is uniform so the client can branch on it. */
export function unauthorized(): Response {
  return Response.json({ error: "Sign in to use this." }, { status: 401 });
}
