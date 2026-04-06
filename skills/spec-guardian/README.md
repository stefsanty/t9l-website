# spec-guardian

A Claude Code skill that keeps your `CLAUDE.md` accurate and enforces
coding guardrails automatically via hooks.

---

## Install

### 1. Copy the skill

```bash
# Global (available in all projects)
mkdir -p ~/.claude/skills/spec-guardian
cp SKILL.md ~/.claude/skills/spec-guardian/SKILL.md

# OR project-local only
mkdir -p .claude/skills/spec-guardian
cp SKILL.md .claude/skills/spec-guardian/SKILL.md
```

### 2. Install the lint hook

```bash
# Copy the hook script to Claude's hooks directory
mkdir -p ~/.claude/hooks
cp spec_lint.py ~/.claude/hooks/spec_lint.py
chmod +x ~/.claude/hooks/spec_lint.py
```

Then merge the contents of `settings.json` into your `~/.claude/settings.json`
(or `.claude/settings.json` for project-local). If you don't have a
`settings.json` yet, just copy it directly:

```bash
cp settings.json ~/.claude/settings.json
```

### 3. Bootstrap CLAUDE.md for a project

```bash
# Option A — use the template
cp CLAUDE.md.template /your/project/CLAUDE.md
# Then fill in the blanks manually or run:

# Option B — let spec-guardian generate it
cd /your/project
claude  # open Claude Code
> /spec-guardian --new
```

---

## Usage

| Command | When to use |
|---|---|
| `/spec-guardian` | Audit + update CLAUDE.md for current project |
| `/spec-guardian --new` | Bootstrap CLAUDE.md from scratch |
| `/spec-guardian --drift` | Check recent file edits against spec rules |
| `/spec-guardian --security` | Security-only pass |

**Recommended cadence:**
- Run `--new` once when starting a project
- Run `/spec-guardian` after any major feature or architectural change
- Run `--drift` before any PR or release

---

## How the hook works

`spec_lint.py` runs automatically after every file Claude writes (`PostToolUse`).
It checks for ~8 critical anti-patterns (hardcoded secrets, insecure storage,
disabled SSL, silent error swallowing, etc.) and prints warnings to stderr.
Claude Code surfaces these warnings in the terminal — Claude sees them and can
self-correct in the same session.

The `SessionStart` hook warns you if `CLAUDE.md` is missing when you open
a project.

---

## Files

```
spec-guardian/
├── SKILL.md              ← skill definition (Claude reads this)
├── spec_lint.py          ← hook script (runs after every file write)
├── settings.json         ← hook config (merge into .claude/settings.json)
├── CLAUDE.md.template    ← starter template for new projects
└── README.md             ← this file
```
