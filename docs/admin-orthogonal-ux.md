# Admin-orthogonal UX (standing rule, v1.67.0)

**Admin role is ORTHOGONAL to user-facing UX.** Admin users see the EXACT same frontend as regular users.

## The only allowed admin-specific UI differences

1. An "Admin" link/button in the account-menu nav (entry to `/admin`).
2. Auto-authentication when accessing `/admin` routes.

That's it.

## What this rules out

ALL other UX gates must be based on auth state, player linkage, league membership, or membership status — **NEVER** on `session.isAdmin`.

- An admin user who's a Player + active PLM in a league sees State A in the recruiting banner exactly like a non-admin would.
- An admin with no Player sees State C exactly like a non-admin would.
- An admin who hasn't paid their season fee sees the unpaid-fee banner exactly like a non-admin would.

UX gates that branch on `isAdmin` are an anti-pattern and should be rejected on review.

## The lone permitted reference outside `/admin`

The dropdown "Admin" link in [`LineLoginButton.tsx`](../src/components/LineLoginButton.tsx) is the only legitimate `session.isAdmin` reference outside `/admin/*`.

## Adding a new gate

If a future PR is tempted to add another `session.isAdmin` check in non-admin code, it almost certainly should be expressed via a different signal:

- `is-PLM-active` — "user has an active PlayerLeagueAssignment in this league"
- `is-PLM-pending` — "user has applied but isn't approved yet"
- `is-allow-self-link` — "this league has `allowSelfLink === true`"
- `is-recruiting` — "this league has `recruitingMode === true`"
- `is-payment-paid` — "user's PLM `paymentStatus === 'PAID'`"

These are observable signals, not role flags. They drive the same UX whether the user is an admin or not.

## Why this matters

Admin sessions are how operators dogfood the product. If admin UX diverges from user UX, the operator never sees what users see, regressions land silently, and trust degrades. The orthogonality rule keeps admin sessions honest.
