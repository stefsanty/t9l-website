#!/usr/bin/env python3
"""
spec_lint.py — PostToolUse hook
Checks a just-written file against the Never rules in CLAUDE.md.
Prints warnings to stderr so Claude Code surfaces them automatically.

Usage: python3 spec_lint.py <file_path>
"""

import sys
import os
import re

# ── Hardcoded anti-pattern checks ──────────────────────────────────────────
# Each entry: (regex_pattern, severity, human_readable_description)
ANTI_PATTERNS = [
    # Secrets
    (r'(api_key|apikey|secret|password|token)\s*=\s*["\'][^"\']+["\']',
     "CRITICAL", "Hardcoded secret/token/password detected"),

    # Insecure storage (JS/TS)
    (r'localStorage\.setItem\s*\(\s*["\'][^"\'"]*(token|key|secret|auth)["\']',
     "CRITICAL", "Sensitive data written to localStorage"),

    # Insecure storage (Swift/ObjC)
    (r'UserDefaults\.standard\.set\s*\(.*(token|key|secret|api)',
     "CRITICAL", "Sensitive data written to UserDefaults — use Keychain"),

    # SSL disabled
    (r'verify\s*=\s*False|ssl_verify\s*=\s*false|rejectUnauthorized\s*:\s*false',
     "CRITICAL", "SSL verification disabled"),

    # Silent error swallowing
    (r'except\s*:\s*pass|catch\s*\(\s*\w*\s*\)\s*\{\s*\}',
     "HIGH", "Silent error swallowing — errors must be logged or surfaced"),

    # console.log with likely PII fields
    (r'console\.(log|debug)\s*\(.*\b(password|token|email|ssn|credit)',
     "HIGH", "Possible PII in console.log — redact before logging"),

    # Direct HTTP (not HTTPS)
    (r'http://(?!localhost|127\.0\.0\.1)',
     "MEDIUM", "Non-localhost HTTP URL — enforce HTTPS"),

    # TODO left by AI
    (r'#\s*TODO.*AI|//\s*TODO.*Claude|<!--\s*TODO.*AI',
     "LOW", "AI-generated TODO left in code — review before shipping"),
]

def load_never_rules(claude_md_path):
    """Extract Never-list items from CLAUDE.md as additional patterns to warn about."""
    rules = []
    if not os.path.exists(claude_md_path):
        return rules
    with open(claude_md_path, "r") as f:
        content = f.read()
    # Look for lines under "### Never" section
    in_never = False
    for line in content.splitlines():
        if re.match(r"###\s*Never", line, re.IGNORECASE):
            in_never = True
            continue
        if in_never and re.match(r"###", line):
            in_never = False
        if in_never and line.strip().startswith("- "):
            rules.append(line.strip()[2:].strip())
    return rules


def check_file(file_path):
    if not file_path or not os.path.isfile(file_path):
        return

    # Skip non-code files
    skip_extensions = {".md", ".txt", ".json", ".yaml", ".yml", ".lock", ".sum"}
    if os.path.splitext(file_path)[1].lower() in skip_extensions:
        return

    with open(file_path, "r", errors="replace") as f:
        try:
            lines = f.readlines()
        except Exception:
            return

    violations = []

    for i, line in enumerate(lines, start=1):
        for pattern, severity, description in ANTI_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                violations.append({
                    "line": i,
                    "severity": severity,
                    "description": description,
                    "content": line.rstrip()
                })

    if violations:
        print(f"\n⚠️  SPEC LINT: {len(violations)} issue(s) in {file_path}", file=sys.stderr)
        for v in violations:
            print(
                f"  [{v['severity']}] Line {v['line']}: {v['description']}\n"
                f"    → {v['content'][:120]}",
                file=sys.stderr
            )
        print("  Run /spec-guardian --drift for full audit.\n", file=sys.stderr)


if __name__ == "__main__":
    file_path = sys.argv[1] if len(sys.argv) > 1 else None
    check_file(file_path)
