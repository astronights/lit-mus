"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorNote, PageHeader } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/**
 * Sign in / sign up.
 *
 * `inviteRequired` comes from the server component next door, which is the only
 * place that reads INVITE_CODE -- the client is told whether a code is needed,
 * never what it is.
 *
 * There is no password reset: it needs an email service, and at this scale a
 * forgotten password is a two-minute fix in Neon.
 */
export function SignInForm({ inviteRequired }: { inviteRequired: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: name || email.split("@")[0]!,
            // Read by the before-hook in src/lib/auth.ts. Sent only when the
            // deployment asks for one; the hook ignores it otherwise.
            ...(inviteRequired ? { fetchOptions: { body: { inviteCode } } } : {}),
          });

    setBusy(false);

    if (result.error) {
      setError(result.error.message ?? "That didn't work.");
      return;
    }

    router.push("/drill");
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title={mode === "signin" ? "Sign in" : "Create an account"}
        subtitle="Drill and Progress track what you know, so they need an account. Browse and Search don't."
      />

      <form onSubmit={submit} className="space-y-3">
        {mode === "signup" ? (
          <Field label="Name (optional)">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              className={inputClass}
            />
          </Field>
        ) : null}

        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className={inputClass}
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className={inputClass}
          />
        </Field>

        {mode === "signup" && inviteRequired ? (
          <Field label="Invite code">
            <input
              type="text"
              required
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              className={inputClass}
            />
          </Field>
        ) : null}

        {error ? <ErrorNote message={error} /> : null}

        <button
          type="submit"
          disabled={busy}
          className="ink-button w-full bg-accent px-4 py-3 font-display text-xl text-accent-foreground disabled:opacity-60"
        >
          {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        className="mt-4 w-full text-sm text-muted-foreground underline underline-offset-2"
      >
        {mode === "signin"
          ? inviteRequired
            ? "I have an invite code"
            : "Create an account"
          : "I already have an account"}
      </button>
    </>
  );
}

const inputClass =
  "ink-card w-full px-4 py-3 text-base outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
