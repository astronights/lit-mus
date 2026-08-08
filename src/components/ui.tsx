import Link from "next/link";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-4">
      <h1 className="font-display text-3xl leading-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm opacity-70">{subtitle}</p> : null}
    </header>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground" role="status">
      {label}
    </p>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="ink-card border-danger px-3 py-2.5 text-sm text-danger">{message}</p>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Shown wherever a signed-out visitor hits Drill or Progress. */
export function SignInPrompt({ what }: { what: string }) {
  return (
    <div className="ink-card p-5 text-center">
      <p className="text-sm">
        {what} needs an account, because it tracks what <em>you</em> know.
      </p>
      <Link
        href="/signin"
        className="ink-button mt-4 inline-block bg-accent px-4 py-2 font-display text-lg text-accent-foreground"
      >
        Sign in
      </Link>
      <p className="mt-3 text-xs opacity-70">Browse and Search work without one.</p>
    </div>
  );
}

export function Chip({ href, children }: { href?: string; children: React.ReactNode }) {
  const className =
    "inline-block rounded-full border-2 border-ink bg-surface-muted px-2.5 py-1 text-xs";
  if (!href) return <span className={className}>{children}</span>;
  return (
    <Link href={href} className={`${className} hover:bg-surface`}>
      {children}
    </Link>
  );
}
