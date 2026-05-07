/**
 * Public-facing slug helper. Used to build per-player Vercel Blob keys
 * (`/api/assign-player`'s LINE-CDN mirror) and to derive consistent ids
 * across the codebase.
 *
 * Pre-v1.71.0 this file also held the legacy Google-Sheets parser surface
 * (the `parseTeams` / `parsePlayers` / `parseSchedule` / `parseGoals` /
 * `parseAllData` family). The Sheets→DB cutover landed at v1.0.x; the
 * parsers stayed dormant. v1.71.0 retires them with the rest of the
 * Sheets surface.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
