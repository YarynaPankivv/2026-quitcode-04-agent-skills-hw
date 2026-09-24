"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const REFRESH_EVERY_MS = 5_000;
// The workflow takes 40–90 s; past this, stop polling a quote that is stuck.
const GIVE_UP_AFTER_MS = 10 * 60_000;

// Re-renders the server page while a quote is queued. Unmounts once the page
// shows another status, which stops the timer.
export function QuoteStatusRefresher() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > GIVE_UP_AFTER_MS) {
        clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);

  return gaveUp ? (
    <p className="text-sm text-amber-700">
      Кошторис готується довше, ніж зазвичай. Оновіть сторінку трохи пізніше.
    </p>
  ) : (
    <p className="text-sm text-slate-500">Сторінка оновлюється сама.</p>
  );
}
