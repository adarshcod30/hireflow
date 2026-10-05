/**
 * Read a rate limit from the environment at request time, so a test (or an
 * operator) can change it without rebuilding the app.
 */
export function rateLimit(envName: string, fallback: number): () => number {
  return () => {
    const n = Number.parseInt(process.env[envName] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
}
