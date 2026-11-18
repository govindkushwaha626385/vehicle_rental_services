import { useRef } from 'react';

/**
 * Guards async page loads against out-of-order resolution.
 *
 * Admin pages often fire overlapping loads (approve → reload while a bulk
 * action reloads, desk save → settle reload, …). Each call to `make()`
 * invalidates every earlier token, and only the latest token may touch state:
 *
 *   const guard = useRequestGuard();
 *   const token = guard.make();
 *   api.load().then((data) => {
 *     if (!guard.isCurrent(token)) return;   // a newer load superseded us
 *     setState(data);
 *   });
 */
export function useRequestGuard() {
  const ref = useRef(0);
  const make = () => {
    ref.current += 1;
    return ref.current;
  };
  const isCurrent = (token) => token === ref.current;
  return { make, isCurrent };
}