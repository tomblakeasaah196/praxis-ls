#!/usr/bin/env python3
"""
Take the em dashes out of copy a tenant reads, one area at a time.

Tenant review, 8 Oct 2026: "No emdashes or double dashes anywhere. It screams
AI." `scripts/check-dashes.js` is the gate and holds the backlog at today's
count; this is the tool that works it down. Point FILES at the area you are
sweeping, read the preview, then pass --apply.

  python3 scripts/dedash.py            # preview every replacement
  python3 scripts/dedash.py --apply    # write them
  (run it twice: a string with two dashes loses one per pass)

WHAT IT DOES. A colon when the second half enumerates or exemplifies the
first, a full stop when it is a second statement. It never recases the tail
downward, because "France - Plan Comptable General" must not come out as
"France: plan Comptable General".

READ THE DIFF AFTERWARDS. This is a heuristic, and it was wrong four times in
the first run on master data. The case that bit was a string STARTING with the
separator (" - none yet", " - live"): there is nothing to the left of the
dash, so the separator vanished and the UI rendered "0 optionsnone yet" and
"v1live". That shape is now left alone, but the general lesson stands.

AND CHECK THE DICTIONARY. tr() looks a translation up BY its English text and
falls back to English silently, so a string changed here whose key still
carries the dash renders English in the French build with nothing failing
anywhere. After a sweep, confirm no key is orphaned:

  node -e "const fs=require('fs'),cp=require('child_process');
    const s=fs.readFileSync('client/src/lib/i18n-dict.ts','utf8');
    const en=s.slice(0,s.indexOf('export const fr'));
    const keys=[...en.matchAll(/^\\s*\"((?:\\\\.|[^\"])*)\":/gm)].map(m=>m[1]);
    const blob=cp.execSync(\"git ls-files 'client/src/**/*.tsx' 'client/src/**/*.ts' | xargs cat\",{maxBuffer:1e9}).toString();
    console.log('orphaned keys:', keys.filter(k=>!blob.includes(k)).length);"
"""
import re, sys, subprocess

APPLY = "--apply" in sys.argv

# POINT THIS AT THE AREA YOU ARE SWEEPING. Left on the last one worked, so the
# diff of this line is part of the record of which rounds have been done.
#   round 1 (master data): features/masterdata/*.tsx, portal/account-manager.tsx
#   round 2 (Smart Mail + My Workspace): comms/inbox/**, workspace/tasks/*
#   round 3 (the whole Monitor family): below
files = subprocess.run(["git","ls-files",
                        "client/src/features/dashboard",
                        "client/src/features/workspace",
                        "client/src/features/ai",
                        "client/src/features/comms",
                        "client/src/features/support"],
                       capture_output=True, text=True, check=True).stdout.split()
files = [f for f in files if f.endswith((".ts", ".tsx"))]
files = [f for f in files if ".test." not in f]

LIT = re.compile(r'(["\'])((?:(?!\1)[^\\]|\\.)*)\1')
MECH = re.compile(r'var\(\s*--|^\s*(?://|\*|/\*)')

# A coordinating conjunction cannot follow a colon: "...nothing malicious: but
# from that row" is not a sentence. Those take a comma.
CONJ = {"but", "and", "so", "or", "yet", "nor"}

def fix(text):
    out = text
    # en dash between numbers is a RANGE: "10–120" reads as "10 to 120". An
    # INTERPOLATED range is the same thing and was not caught: "{{from}}–{{to}}
    # on your side" is a time span, and the separator rule below turned it into
    # "{{from}}: {{to}}", which reads as a label and a value.
    N = r'(?:\{\{\s*\w+\s*\}\}|\$\{[^}]+\}|\d)'
    out = re.sub(rf'({N})\s*[–]\s*({N})', r'\1 to \2', out)
    # A string that is ONLY a dash, or a value wrapped in them ("— none —"),
    # is an empty-value GLYPH, not a sentence. Blank reads better in a stat
    # tile and "None" in a dropdown, so those are decided one at a time rather
    # than guessed at here.
    if re.fullmatch(r'\s*[—–]\s*', out) or re.fullmatch(r'\s*[—–][^—–]*[—–]\s*', out):
        return out
    def repl(m):
        head, tail = m.group(1).rstrip(), m.group(2).lstrip()
        if not head or not tail:
            # A string that STARTS with the separator (" - none yet") has no
            # left half, so there is nothing to join and dropping the dash
            # would weld it onto whatever JSX renders before it. Left alone:
            # the call site has to decide what separator it wanted.
            return m.group(0)
        # A colon when the second half ENUMERATES or exemplifies the first;
        # a full stop when it is a second statement.
        # A colon when the second half enumerates or exemplifies the first; a
        # full stop when it is a second statement. The tail is NEVER recased
        # downward: "France — Plan Comptable Général" must not become
        # "France: plan Comptable Général".
        first = tail.split()[0].lower().strip(",")
        if first in CONJ:
            # An aside, not an explanation: a comma is the only punctuation that
            # leaves the clause standing.
            return f"{head}, {tail}"
        listish = ("," in tail or tail.endswith("…") or len(tail) < 40
                   or first in {"the", "a", "an", "one", "each", "every", "its"})
        if listish and ":" not in head and not head.endswith((".", ":", "?", "!")):
            return f"{head}: {tail}"
        return f"{head}. {tail[0].upper() + tail[1:]}"
    out = re.sub(r'([^—–]*?)\s*[—–]\s*([^—–]*)$', repl, out, count=1) if re.search(r'[—–]', out) else out
    return out

def fix_ranges(text):
    N = r'(?:\{\{\s*\w+\s*\}\}|\$\{[^}]+\}|\d)'
    return re.sub(rf'({N})\s*[–]\s*({N})', r'\1 to \2', text)

shown = 0
byhand = {}
changed_files = {}
for f in files:
    lines = open(f, encoding="utf-8").read().split("\n")
    hits = 0
    for i, line in enumerate(lines):
        if MECH.search(line):
            continue
        new_line = line
        for m in list(LIT.finditer(line)):
            lit = m.group(2)
            if not re.search(r'[—–]', lit):
                continue
            fixed = fix(lit)
            # A string with TWO dashes left is a PARENTHETICAL ("something long
            # — a proforma, a memo — opens here"), and the separator rule only
            # ever rewrites the LAST one. That leaves an em dash standing AND
            # breaks the sentence around it ("a summary: it opens here"), so the
            # pair is listed for a human instead of half-rewritten. Running the
            # tool twice does not help: it yields two colons.
            glyph = (re.fullmatch(r'\s*[—–]\s*', lit)
                     or re.fullmatch(r'\s*[—–][^—–]*[—–]\s*', lit))
            if not glyph and len(re.findall(r'[—–]', fix_ranges(lit))) >= 2:
                byhand.setdefault(f, []).append(lit)
                continue
            if fixed != lit and "\\" not in lit:
                new_line = new_line.replace(m.group(0), m.group(1) + fixed + m.group(1), 1)
                hits += 1
                if shown < 28:
                    print(f"- {lit[:110]}\n+ {fixed[:110]}\n")
                    shown += 1
        if new_line != line:
            lines[i] = new_line
    if hits:
        changed_files[f] = hits
        if APPLY:
            open(f, "w", encoding="utf-8").write("\n".join(lines))

print("---- would change", sum(changed_files.values()), "strings in", len(changed_files), "files")
if byhand:
    n = sum(len(v) for v in byhand.values())
    print(f"\n---- {n} PARENTHETICAL strings in {len(byhand)} files, left for a human:")
    for f, lits in byhand.items():
        for l in lits:
            print(f"  {f}\n    {l[:150]}")

