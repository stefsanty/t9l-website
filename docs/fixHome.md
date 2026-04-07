# Home Tab UX Simplification



## Context



The Home tab currently stacks four loosely-related components (`GuestLoginBanner` → `MyMatchdayCard` → `NextMatchdayBanner` → `MatchdayAvailability`) that compete for attention and create confusion about what is connected to what. A logged-in player should be able to answer three questions in 10 seconds:



1. **What date am I playing next?**

2. **How do I RSVP (going / undecided / not going)?**

3. **What are the details of my next matchday?**



Today, those answers are scattered:



- The date appears in **two** places (`MyMatchdayCard` *and* `NextMatchdayBanner`'s date pill) — and they can disagree once the user clicks the matchday pill selector.

- The **RSVP control is buried** below the entire match banner, inside `MatchdayAvailability` (~400px down).

- The **matchday pill selector is the most visually prominent interactive element** in the banner, even though browsing past matchdays is a secondary task.

- All four playing teams render an **expanded pitch formation by default**, pushing everything else off-screen.

- The "UPCOMING" / "RESULTS" header, the venue link, the date pill, and the pill selector all visually shout for attention before the user sees a single match.



The goal is **fewer cards, fewer buttons above the fold, and a clear visual hierarchy** that funnels the eye: matchday → RSVP → match details.



## Recommended Approach



Collapse the three top-of-page cards into **one unified hero card** that answers all three questions in a single visual unit, and demote everything else.



### New Home tab structure



```

Header (fixed, unchanged)

GuestLoginBanner (unchanged, only when logged out)



┌─ HERO CARD ──────────────────────────────────┐

│  YOUR NEXT MATCHDAY            [browse ▾]    │  ← tiny eyebrow + browse toggle

│  MD5 · Sat Apr 11                            │  ← BIG, the answer to Q1

│  Tennozu Park C ↗                            │  ← venue link, small

│                                              │

│  [ Going ] [ Undecided ] [ Not going ]       │  ← RSVP, the answer to Q2

│                                              │

│  ─────────────────────────────────────       │

│                                              │

│  MFC  vs  HSC          19:05                 │  ← matches, the answer to Q3

│  FXC  vs  TPD          19:45                 │

│  MFC  vs  TPD          20:25                 │

│  Sitting out: Hygge SC                       │

└──────────────────────────────────────────────┘



(matchday pills hidden by default, revealed by [browse ▾])



PLAYER AVAILABILITY  ───────────             ← collapsed by default

▸ Mariners FC      4 going · 2 undecided

▸ Hygge SC         3 going

▸ Fenix FC         5 going · 1 undecided

▸ FC Torpedo       2 going

```



### Specific changes



1. **Delete `MyMatchdayCard.tsx`** — its job (showing the user's next matchday + status) is absorbed by the hero card. Remove the import and usage in `Dashboard.tsx`.



2. **Rewrite `NextMatchdayBanner.tsx` as the hero card.** Same file, same props, restructured contents:

   - Replace the "UPCOMING / RESULTS" + pulsing dot + date-pill header with a clean two-line hero: tiny eyebrow label (`YOUR NEXT MATCHDAY` when viewing the user's next game, `MATCHDAY RESULTS` when viewing a past one, `MATCHDAY DETAILS` when browsing other future matchdays) and a single big line: `MD5 · Sat Apr 11` (use `font-display`, large size, matching the visual weight currently wasted on "UPCOMING").

   - Move the venue link directly under the date.

   - **Embed `RsvpButton` here**, immediately after the date/venue, *only* when `selectedMatchdayId` matches the user's actual next playing matchday and `userTeamIsPlaying`. This makes the RSVP the second thing the eye lands on.

   - Keep the existing match list (3 rows), but tighten vertical spacing — current `space-y-5` + `mb-6` + outer `p-6` is too generous now that this card is doing more work.

   - Add a small "Sitting out: <team>" line at the bottom of the matches block (currently the sitting-out info is implicit).

   - **Hide the matchday pill selector by default.** Replace it with a small `[browse ▾]` toggle in the top-right of the hero. Clicking it reveals the existing pill row inline (or below the card). This keeps browsing possible without making it the loudest UI on the page.

   - Keep the existing `useEffect` that auto-selects the player's next matchday on mount.



3. **Move `RsvpButton` out of `MatchdayAvailability.tsx`.** Remove the `pl-card` wrapper around it and the `userTeamIsPlaying` check there. `MatchdayAvailability` becomes purely "who else is coming" and no longer fights the hero for attention.



4. **Collapse `MatchdayAvailability` team cards by default.** Change the `useState` initializer in `MatchdayAvailability.tsx:236` from `new Set(playingTeams.map((t) => t.id))` to `new Set()`. The pitch formation is a delightful detail but it should be opt-in, not default. Also reduce the section's top margin (`mt-4` → keep, but the heading `Player Availability` should feel like a clearly secondary section — consider greying it down further or adding more vertical breathing room above it so it visually separates from the hero).



5. **Remove the duplicate date display.** The date pill in the current banner header (`NextMatchdayBanner.tsx:128-130`) goes away — date now lives in the hero line.



6. **Eyebrow label logic** (in the new hero):

   - If `selectedMatchdayId === userNextPlayingMatchdayId` → `YOUR NEXT MATCHDAY`

   - Else if matchday is in the past → `MATCHDAY RESULTS`

   - Else → `MATCHDAY DETAILS`

   - This resolves the "wait, why does it still say *my* next matchday when I'm browsing MD7?" cognitive dissonance.



### Why this works for the 10-second test



- **Q1 (when?)** — The biggest text on the page is `MD5 · Sat Apr 11`, in the first card. Eyes land there first.

- **Q2 (RSVP?)** — The only prominent buttons in the hero are the three RSVP buttons. Nothing else competes.

- **Q3 (details?)** — Match list sits directly below the RSVP, in the same card, visually connected.

- **Reduced noise** — The pill selector, the team availability expansions, and the secondary "browse other matchdays" affordance all become opt-in rather than always-on.



## Critical files to modify



- `src/components/Dashboard.tsx` — remove `MyMatchdayCard` import + usage (lines 11, 148–151).

- `src/components/NextMatchdayBanner.tsx` — major rewrite of the header section; embed `RsvpButton`; gate pill selector behind a toggle. Will need new props: `availabilityStatuses`, `userNextPlayingMatchdayId` (or compute internally from session + matchdays — already done in the existing `useEffect`).

- `src/components/MatchdayAvailability.tsx` — remove RSVP block (lines 327–334); change default-expanded `Set` to empty (line 236–238); remove unused `RsvpButton` import.

- `src/components/MyMatchdayCard.tsx` — **delete file**.



`RsvpButton.tsx` itself does not need to change — it's already self-contained and reads session internally.



## Verification



1. `npm run dev` — load `/` as a logged-in player whose team plays in the next upcoming matchday.

   - Confirm hero shows `YOUR NEXT MATCHDAY`, the correct date, the RSVP buttons, and 3 matches.

   - Confirm `MyMatchdayCard` is gone and there's no duplicate date.

   - Confirm Player Availability section is collapsed; clicking a team reveals the pitch.

2. Click the `[browse ▾]` toggle → matchday pills appear → click MD2 (a past matchday).

   - Eyebrow should change to `MATCHDAY RESULTS`.

   - RSVP buttons should disappear (only visible on the user's actual next matchday).

   - Match scores + scorers should render as before.

3. Click the next future matchday where the user's team plays — eyebrow should still say `YOUR NEXT MATCHDAY`. Click a different future matchday — eyebrow should say `MATCHDAY DETAILS` and RSVP should be hidden.

4. Log out (or load as guest) — `GuestLoginBanner` shows; hero still renders with the league's next matchday but no RSVP and the eyebrow reads `MATCHDAY DETAILS` (or similar non-personal label).

5. Load as a player whose team is sitting out the next matchday — hero should jump to the next matchday they actually play (existing `useEffect` already handles this).

6. Submit an RSVP from the hero — confirm the existing optimistic UI + `router.refresh()` flow still works and the sheet writes succeed.

7. `npm run lint` — no warnings.

8. Mobile viewport check (375×812): hero card + RSVP + at least the first match should fit above the fold. Player Availability heading should be visible at the bottom without scrolling, signaling there's more below.

