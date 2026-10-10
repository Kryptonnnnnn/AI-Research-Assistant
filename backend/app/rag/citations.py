"""Citation extraction and validation. Only labels that map to *retrieved* chunks survive."""

from __future__ import annotations

import re

_GROUP = re.compile(r"\s?\[\s*(S\d+(?:\s*[,;]\s*S\d+)*)\s*\]")


def process_answer(text: str, valid_labels: set[str]) -> tuple[str, list[str], list[str]]:
    """Return (cleaned_text, cited_labels_in_order, invalid_labels_removed)."""
    used: list[str] = []
    invalid: list[str] = []

    def repl(m: re.Match) -> str:
        labels = [x.strip() for x in re.split(r"[,;]", m.group(1))]
        good = [lab for lab in labels if lab in valid_labels]
        invalid.extend(lab for lab in labels if lab not in valid_labels)
        for lab in good:
            if lab not in used:
                used.append(lab)
        return f" [{', '.join(good)}]" if good else ""

    cleaned = _GROUP.sub(repl, text)
    return cleaned.strip(), used, invalid
