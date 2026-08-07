"use client";

import { useCallback, useEffect, useState } from "react";

export type ApiState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** 401 from the API: the caller renders a sign-in prompt rather than an error. */
  unauthorized: boolean;
  reload: () => void;
};

/** Minimal GET-and-render hook. No cache, no dedupe -- the screens are small. */
export function useApi<T>(url: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [loading, setLoading] = useState(url !== null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setUnauthorized(false);

    fetch(url)
      .then(async (response) => {
        if (response.status === 401) {
          if (!cancelled) setUnauthorized(true);
          return null;
        }
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return (await response.json()) as T;
      })
      .then((result) => {
        if (!cancelled && result !== null) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, nonce]);

  return { data, error, loading, unauthorized, reload };
}
