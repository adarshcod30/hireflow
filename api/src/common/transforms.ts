// Input normalisers used with class-transformer's @Transform. Typed as `unknown`
// in and out, so they are safe to reason about and need no `any`.

export const trimLower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

/** Skills are compared as lowercase words, so store them that way: trimmed, unique, no blanks. */
export const normaliseSkills = ({ value }: { value: unknown }): unknown => {
  if (!Array.isArray(value)) return value;
  const cleaned = (value as unknown[]).map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v));
  return [...new Set(cleaned.filter((v) => v !== ''))];
};
