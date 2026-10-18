"use client";

import { useEffect, useState } from "react";

/**
 * useState that remembers its value in localStorage, per browser. It reads
 * after mount (the server render has no storage) and falls back to `initial`
 * when storage is blocked or the stored value fails `valid`.
 */
export function useStoredState<T>(key: string, initial: T, valid: (v: unknown) => boolean = () => true) {
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed)) setValue(parsed as T);
      }
    } catch {
      // blocked or corrupted storage: keep the default
    }
    setReady(true);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full or blocked
    }
  }, [key, value, ready]);

  return [value, setValue] as const;
}

export const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown) =>
    values.includes(v as T);
export const isString = (v: unknown) => typeof v === "string";
export const isStringArray = (v: unknown) => Array.isArray(v) && v.every(isString);
