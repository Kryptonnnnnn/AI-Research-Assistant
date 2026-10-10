"""Whitespace normalisation and extraction-artifact cleanup that preserves meaning."""

from __future__ import annotations

import re
import unicodedata

_LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl"}
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    for k, v in _LIGATURES.items():
        text = text.replace(k, v)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ").replace("­", "")
    text = _CONTROL.sub("", text)
    # Re-join words hyphenated across line breaks ("exam-\nple" -> "example").
    text = re.sub(r"(?<=[a-z])-\n(?=[a-z])", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def unwrap_lines(text: str) -> str:
    """Join hard-wrapped lines inside a paragraph (typical for PDF text) but keep blank-line breaks,
    list items and headings."""
    out: list[str] = []
    for para in re.split(r"\n\s*\n", text):
        lines = [ln.strip() for ln in para.split("\n") if ln.strip()]
        if not lines:
            continue
        buf = lines[0]
        for ln in lines[1:]:
            if re.match(r"^([-*•]|\d+[.)]|#{1,6}\s)", ln) or buf.endswith(":"):
                out.append(buf)
                buf = ln
            else:
                buf += " " + ln
        out.append(buf)
        out.append("")
    return "\n".join(out).strip()
