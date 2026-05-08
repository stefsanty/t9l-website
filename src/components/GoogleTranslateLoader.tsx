'use client'

import { useEffect } from 'react'

/**
 * v1.80.4 — phase 3 perf: gate the Google Translate widget behind locale.
 *
 * Pre-v1.80.4 the GT widget loaded on every page via two `<Script
 * strategy="afterInteractive">` tags in `app/layout.tsx`. PSI flagged the
 * GT main-script CSS (`gstatic.com/.../el_main_css`) as the top entry on
 * the network critical path (1,634 ms chain), and the GT bundle as the
 * largest unused-JS contributor (~118 KiB transferred / 93.5 KiB unused
 * for the typical EN visitor).
 *
 * Behavior:
 *   - On mount, read the user's locale signal (localStorage `t9l-lang`,
 *     falling back to the `googtrans=/en/ja` cookie set by the inline
 *     boot script in `app/layout.tsx`).
 *   - If the signal is `ja` → inject the GT script + init callback. GT
 *     reads the cookie itself and translates the rendered DOM.
 *   - If the signal is `en` (default for the vast majority of visits,
 *     including PSI's lab tests) → render nothing. No GT script is
 *     fetched, no `el_main_css` lands on the critical path, no
 *     `el_main` JS bundle is parsed.
 *
 * The inline boot script in `app/layout.tsx` still runs on every visit:
 *   - It sets `t9l-lang` localStorage + `googtrans` cookie based on
 *     `navigator.language` for first-time visitors. So a Japanese user
 *     hitting the site for the first time has `t9l-lang === 'ja'` set
 *     before this component's `useEffect` reads it, and GT loads on
 *     this same render. No regression for JP users.
 *
 * The `LanguageToggle` component still triggers a full reload on locale
 * change, which is the existing UX. After reload the new locale is
 * present in localStorage / cookie, and this loader either injects GT
 * (→ JP) or stays inert (→ EN). The toggle's reload is what makes a
 * lazy-loader-on-mount strategy correct here: we don't need to handle
 * runtime locale changes inside this component.
 *
 * Why useEffect (not direct render): the locale signal lives in
 * localStorage / document.cookie, which are unavailable during SSR.
 * Doing the check inside `useEffect` guarantees we only inject after
 * hydration, on the client, where reading either source is safe.
 */
export default function GoogleTranslateLoader() {
  useEffect(() => {
    let needsJp = false
    try {
      needsJp = localStorage.getItem('t9l-lang') === 'ja'
    } catch {
      // localStorage unavailable (Safari private mode, etc.) — fall through
      // to the cookie check below.
    }
    if (!needsJp) {
      try {
        needsJp = document.cookie.includes('googtrans=/en/ja')
      } catch {
        // Defensive: cookie access can throw in unusual browsers.
      }
    }

    if (!needsJp) return

    // GT calls this global by name on load (cb=googleTranslateElementInit).
    // Define it on `window` BEFORE injecting the script tag — otherwise the
    // script may evaluate the callback before our React effect has a chance
    // to assign it.
    interface GoogleTranslateWindow extends Window {
      googleTranslateElementInit?: () => void
      google?: {
        translate?: {
          TranslateElement: new (
            opts: { pageLanguage: string; autoDisplay: boolean },
            elementId: string,
          ) => unknown
        }
      }
    }
    const w = window as GoogleTranslateWindow
    w.googleTranslateElementInit = function googleTranslateElementInit() {
      const TranslateElement = w.google?.translate?.TranslateElement
      if (!TranslateElement) return
      new TranslateElement(
        { pageLanguage: 'en', autoDisplay: false },
        'google_translate_element',
      )
    }

    const id = 'google-translate-script'
    if (document.getElementById(id)) return // idempotent (StrictMode dev)
    const s = document.createElement('script')
    s.id = id
    s.src =
      'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
    s.async = true
    document.body.appendChild(s)
  }, [])

  return null
}
