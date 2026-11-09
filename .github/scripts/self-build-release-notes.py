"""Release notes for a self-build: what changed since the previous fork release.

Usage: git log --format=%s upstream-TAG..HEAD |
  self-build-release-notes.py VERSION TAG UPSTREAM_NOTES_FILE PREVIOUS_SUBJECTS_FILE [PREVIOUS_TAG]
"""

import re
import sys
from pathlib import Path

# apps/desktop/src/updates/releaseNotes.ts reads a summary up to this block: a stats line,
# one bullet list and a "### Plus N more" footer. Prose there would replace the list.
DETAILS = re.compile(r"<details>\s*<summary>\s*Full changelog\s*</summary>", re.IGNORECASE)
STATS = re.compile(r"^(?:\*\*)?v\S+?(?:\*\*)? · ")
CHANGE = re.compile(r"^(?:feat|fix|perf)(?:\([^)]*\))?!?: (.+)$")
MARKUP = re.compile(r"(?<!`)(`+)(?!`).+?(?<!`)\1(?!`)|<")


def fork_changes(subjects, previous=frozenset()):
    for subject in subjects:
        match = CHANGE.match(subject.strip())
        if match and subject.strip() not in previous:
            text = MARKUP.sub(lambda m: m[0] if m[1] else "&lt;", match.group(1))
            yield f"{text[0].upper()}{text[1:]}"


def release_notes(version, tag, subjects, upstream, previous_subjects, previous_tag):
    changes = list(fork_changes(subjects, {subject.strip() for subject in previous_subjects}))
    count = f"{len(changes)} new fork change{'' if len(changes) == 1 else 's'}"
    if previous_tag:
        count += f" since {previous_tag}"
    fork_list = "\n".join(f"- {change}" for change in fork_changes(subjects))
    full = [f"### Fork changes on pingdotgg/t3code {tag}\n\n{fork_list}"] if fork_list else []
    header, bullets, footer = f"**v{version}** · {count}", [], []
    # Patch Z*100+N: N is 0 only for the first fork build of an upstream release.
    if int(version.rsplit(".", 1)[1]) % 100 == 0:
        upstream = upstream.strip()
        block = DETAILS.search(upstream)
        lines = [line.strip() for line in upstream[: block.start() if block else 0].splitlines()]
        lines = [line for line in lines if line]
        stats = lines.pop(0).split(" · ", 1)[1] if lines and STATS.match(lines[0]) else None
        if block and all(re.match(r"^(?:[-*] |#{1,6} )", line) for line in lines):
            bullets = [line for line in lines if not line.startswith("#")]
            footer = [line for line in lines if line.startswith("### Plus ")]
            upstream = upstream[block.end() :].replace("</details>", "", 1).strip()
        header = f"**v{version}** · {tag}{f' · {stats}' if stats and bullets else ''} · {count}"
        full.append(f"### pingdotgg/t3code {tag}\n\n{upstream}")
    details = "\n\n".join(full)
    # Only a summary shared with upstream's bullets needs each fork change marked.
    marker = "**Fork.** " if bullets else ""
    parts = [header, "\n".join([f"- {marker}{change}" for change in changes] + bullets), *footer]
    parts.append(f"<details>\n<summary>Full changelog</summary>\n\n{details}\n\n</details>")
    return "\n\n".join(part for part in parts if part) + "\n"


if __name__ == "__main__":
    version, tag, upstream_file, previous_file, *previous_tag = sys.argv[1:]
    sys.stdout.write(
        release_notes(
            version,
            tag,
            sys.stdin.read().splitlines(),
            Path(upstream_file).read_text(),
            Path(previous_file).read_text().splitlines(),
            previous_tag[0] if previous_tag and previous_tag[0] else None,
        )
    )
