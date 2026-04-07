# Plan: Internationalize T9L app (English → Japanese, runtime machine translation)



## Context



A language toggle (EN/JP) was recently added to `Dashboard.tsx` (commits bf77849, 620af32), but it is cosmetic only — the `lang` state is never read. The app currently has ~70 hardcoded English strings spread across 12 client components plus `layout.tsx`, and date formatting is locked to `en-US`.



The goal is to make the whole app display correctly in Japanese when the user toggles to JP, **without** hand-maintaining a Japanese translation file. English remains the single source of truth in code; Japanese is generated on demand by Claude and cached in the existing Upstash Redis.



### Decisions locked in

- **Translation:** runtime via Claude API (Haiku) + Upstash Redis per-string cache.

- **Persistence:** HTTP cookie `t9l-lang` (`en` | `ja`), readable in server components so the correct locale renders on first paint.

- **Scope:** all hardcoded UI strings, date/time formatting, and the 4 rating metric labels. **Not** translated: team names, player names, matchday labels (MD1…), position codes (GK/DF/MF/FWD), venue name, scores.



---



## Architecture



```

cookie t9l-lang ─┐

                 ▼

        layout.tsx (server)

           │ reads cookie

           │ calls translateDict(en, locale)  ─── Redis cache hit? return

           │                                  └── miss? batch call Claude, write cache

           ▼

     <I18nProvider dict={…} locale={…}>

           │

           ▼

   Server + client components use useT('homeTab') / t('homeTab')

```



### Key choice: dictionary with string keys, not inline `t('English text')`



We centralize every English string in `src/i18n/en.ts` as a flat object. This gives us:

- A finite, enumerable key list (needed because runtime API translation can't know about strings it has never seen).

- Easy review of what's user-facing.

- English IS the master — the TS file is the source of truth; JP is derived.



```ts

// src/i18n/en.ts

export const en = {

  tabHome: 'Home',

  tabStats: 'Stats',

  tabTeams: 'Teams',

  vibes: 'Vibes',

  vibesEnjoyment: 'Enjoyment',

  vibesTeamwork: 'Teamwork',

  vibesCompetitiveness: 'Competitiveness',

  vibesRefereeing: 'Refereeing',

  standings: 'Standings',

  statistics: 'Statistics',

  results: 'Results',

  squads: 'Squads',

  seasonFinished: 'Season Finished',

  seeYouAutumn: 'See you in the Autumn!',

  // … ~70 entries covering all enumerated strings

} as const;

export type MessageKey = keyof typeof en;

```



---



## Implementation steps



### 1. Add Anthropic SDK + i18n module scaffolding

- `npm install @anthropic-ai/sdk` (reuse existing `@upstash/redis`).

- New env var: `ANTHROPIC_API_KEY`. Document in `CLAUDE.md` Environment Variables section; fall back to English if missing (graceful degradation, matching the pattern used for sheet/KV/Blob).

- Create `src/i18n/` folder:

  - `en.ts` — master dictionary (all ~70 strings enumerated above).

  - `translate.ts` — server-only: `translateDict(en, locale): Promise<Record<MessageKey, string>>`.

  - `I18nProvider.tsx` — client component, React context with `{locale, dict}`; exports `useT()` hook returning `(key: MessageKey) => string`.

  - `getLocale.ts` — server-only: reads `t9l-lang` cookie, defaults to `en`, validates against `['en','ja']`.

  - `format.ts` — `formatMatchDate(dateStr, locale)` and `formatKickoff(time, locale)` using `Intl.DateTimeFormat`.



### 2. Runtime translator (`src/i18n/translate.ts`)

- If locale === `'en'`, return `en` unchanged.

- Otherwise:

  1. Batch-read Redis keys `t9l:i18n:ja:<key>` via `redis.mget`.

  2. Collect the subset of keys still missing.

  3. If non-empty, issue **one** Claude API call (`claude-haiku-4-5-20251001`, JSON mode) with a prompt:

     > "You are translating UI strings for a Tokyo recreational football league webapp from English to natural, concise Japanese suitable for a mobile app. Keep it short — these are UI labels, not prose. Return strict JSON mapping each key to its translation. Input: {json of missing {key: english}}"

  4. Write each result back to Redis (no TTL — translations are stable; invalidate manually if en.ts changes).

  5. Merge cache hits + new translations and return.

- Wrap the whole function in a `try/catch` — on any failure, log and return `en` so the app never breaks because of translation.

- Since this runs inside the server `layout.tsx` render, memoize within-request via `React.cache` so multiple server components sharing the layout don't re-run it.



### 3. Wire into `src/app/layout.tsx`

- Currently a server component with `<html lang="en">`. Change to:

  ```tsx

  const locale = await getLocale();           // reads cookie

  const dict = await translateDict(en, locale);

  return (

    <html lang={locale}>

      <body>

        <AuthProvider>

          <I18nProvider locale={locale} dict={dict}>

            {children}

          </I18nProvider>

        </AuthProvider>

      </body>

    </html>

  );

  ```

- Move the `<html lang>` string literal to come from `locale`.

- Translate `metadata.title` / `metadata.description` via a `generateMetadata` export that also reads the cookie + calls `translateDict`.

- **Caching implication:** reading cookies forces the route to dynamic rendering. To preserve sheet fetch caching, wrap the existing `fetchSheetData()` call in `unstable_cache` with a 300s TTL and tag-based invalidation keyed on nothing locale-specific (sheet data is locale-agnostic). RSVP's existing `revalidatePath('/')` still works via tag bust. This preserves the spirit of the current ISR behavior while allowing per-locale rendering.



### 4. Language toggle → cookie writer

- Extract the current inline toggle from `Dashboard.tsx` lines 117, 142–159 into `src/components/LanguageToggle.tsx` (client component).

- Replace `useState` with a read of `useT()`'s `locale` and a POST to a tiny new server action `setLocaleAction(locale)` that calls `cookies().set('t9l-lang', locale, { maxAge: 60*60*24*365, path: '/' })` then `revalidatePath('/')`.

- Use `router.refresh()` after the action resolves so the server re-renders with the new cookie and new dict.



### 5. Replace hardcoded strings

Refactor each of the following files to import `useT` (client) or pull from `dict` prop (server) and replace string literals. The full list of target lines is captured in exploration notes:



- `src/components/Dashboard.tsx` — tabs, section headings, Vibes metrics, season-finished empty state, footer.

- `src/components/NextMatchdayBanner.tsx` — eyebrow labels, "close/browse", "Kickoff Time", "FT", "Sitting out", "You are not scheduled…". Also swap `formatShortDate` → `formatMatchDate(dateStr, locale)` from the new `format.ts`.

- `src/components/MatchdayAvailability.tsx` — "LINEUP", "Who Played", "Player Availability", "going"/"undecided"/"played" badges.

- `src/components/RsvpButton.tsx` — "Going"/"Undecided"/"Not going", "Your RSVP", error message.

- `src/components/MatchResults.tsx` — "Guest (non-rostered)", "asst:", "No goal details recorded".

- `src/components/SquadList.tsx` — "SQUAD MEMBERS", "AVAILABILITY", status badges.

- `src/components/TopPerformers.tsx` — "PLAYER" header, "Load more players", emoji column titles.

- `src/components/LeagueTable.tsx` — column headers (POS/CLUB/MP/…). Convert to client or pass `dict` as prop since it's server-rendered today.

- `src/components/GuestLoginBanner.tsx` — banner title, description, "Login".

- `src/components/LineLoginButton.tsx` — modal copy, "Sign out", "Playing as", etc.

- `src/components/AssignPlayerClient.tsx` — "Who are you?", subtitle, search placeholder, buttons.

- `src/app/layout.tsx` — metadata title/description.



### 6. Date/time formatting (`src/i18n/format.ts`)

- `formatMatchDate(dateStr, locale)` — use `new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric' })`. Replaces the hand-rolled month array in `NextMatchdayBanner.tsx` lines 9–21.

- Kickoff times like `"19:05"` are already locale-neutral digits — leave as-is. No change needed for the `match.kickoff` string itself, only its label ("Kickoff Time") is translated.



### 7. Keep dynamic sheet data untouched

Explicitly do NOT touch: `team.name`, `team.shortName`, `player.name`, `player.position`, `matchday.label`, `goal.scorer`, venue `"Tennozu Park C"`. These flow through unchanged.



---



## Critical files to modify



**New:**

- `src/i18n/en.ts`

- `src/i18n/translate.ts`

- `src/i18n/I18nProvider.tsx`

- `src/i18n/getLocale.ts`

- `src/i18n/format.ts`

- `src/components/LanguageToggle.tsx`

- `src/app/actions/setLocale.ts` (server action)



**Modified:**

- `src/app/layout.tsx` — locale-aware `<html lang>`, metadata, provider wiring.

- `src/app/page.tsx` — wrap `fetchSheetData` in `unstable_cache`; pass dict to any server-rendered children that need it.

- `src/components/Dashboard.tsx` — remove inline toggle + `lang` state, mount `LanguageToggle`, use `useT`.

- All 11 other component files listed in step 5.

- `CLAUDE.md` — document the i18n module, `ANTHROPIC_API_KEY` env var, and the cookie-driven rendering change (per the maintenance rule at the top of the file).

- `package.json` — add `@anthropic-ai/sdk`.



---



## Verification



1. **Dev server, English path:** `npm run dev`, load `/`, confirm the page matches today's behavior exactly (toggle defaults to EN; all copy unchanged).

2. **Toggle to JP:** click JP in header. Cookie `t9l-lang=ja` gets set; page refreshes; every hardcoded label renders in Japanese. Player/team/matchday labels remain unchanged.

3. **First-render latency:** first JP toggle triggers one Claude API call (all ~70 keys missing). Subsequent toggles hit Redis and should be <100ms added to render.

4. **Cache persistence:** stop/restart dev server, toggle JP again — no Claude call, all strings served from Redis.

5. **Graceful fallback:** unset `ANTHROPIC_API_KEY`, clear Redis, toggle JP — page renders English (no crash) and logs a warning.

6. **RSVP flow still works:** log in via LINE in JP mode, submit an RSVP, confirm the write to Sheets succeeds and optimistic UI text is in Japanese.

7. **Date formatting:** matchday date "2026-04-15" displays as "Apr 15" in EN and "4月15日" in JP (verify in `NextMatchdayBanner`).

8. **Lint + build:** `npm run lint && npm run build`.

9. **Cache invalidation:** when `en.ts` changes in future, manually bust via `redis.del` pattern `t9l:i18n:ja:*` — document this in `CLAUDE.md`.

