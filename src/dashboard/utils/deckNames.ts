function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Append today's date to the suggested base name, then bump (2), (3) etc.
 * until the result doesn't collide with an existing deck. Used for cards
 * imported automatically (e.g. via the Gemini flow) so each batch lands in
 * a fresh, dated deck.
 */
export function uniqueDeckName(base: string, existingNames: Set<string>): string {
  const cleanBase = base.trim() || 'Gemini import';
  const withDate = `${cleanBase} - ${todayISO()}`;
  if (!existingNames.has(withDate)) return withDate;
  let n = 2;
  while (existingNames.has(`${withDate} (${n})`)) n++;
  return `${withDate} (${n})`;
}
