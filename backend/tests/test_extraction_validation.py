import pytest

from app.core.errors import PayloadTooLarge, ValidationFailed
from app.ingestion.cleaning import clean_text
from app.ingestion.extractors import ExtractionError, extract
from app.ingestion.validation import sanitize_filename, validate_content, validate_metadata
from tests.conftest import PHOTO, make_blank_pdf, make_docx, make_pdf


def test_pdf_extraction_keeps_pages():
    doc = extract(make_pdf([PHOTO, "Second page about mitochondria and ATP synthesis in cells."]), ".pdf")
    assert doc.page_count == 2
    assert [s.page for s in doc.segments] == [1, 2]
    assert "Photosynthesis" in doc.segments[0].text


def test_scanned_pdf_gives_helpful_error():
    with pytest.raises(ExtractionError, match="scanned"):
        extract(make_blank_pdf(), ".pdf")


def test_corrupted_pdf():
    with pytest.raises(ExtractionError):
        extract(b"%PDF-1.4\nthis is not really a pdf at all", ".pdf")


def test_docx_extraction_headings_and_tables():
    data = make_docx(
        [
            ("h1", "Study Title"),
            ("p", "Intro paragraph about the study goals."),
            ("h2", "Methods"),
            ("p", "We measured many things carefully."),
        ]
    )
    doc = extract(data, ".docx")
    assert doc.title == "Study Title"
    assert any(s.heading == "Methods" for s in doc.segments)


def test_corrupt_docx():
    with pytest.raises(ExtractionError):
        extract(b"PK\x03\x04garbage", ".docx")


def test_markdown_headings():
    doc = extract(
        b"# Title\n\nIntro text goes here for the document.\n\n## Part Two\n\nMore content lives in this section.", ".md"
    )
    assert doc.title == "Title"
    assert [s.heading for s in doc.segments] == ["Title", "Part Two"]


def test_empty_text_rejected():
    with pytest.raises(ExtractionError):
        extract(b"   \n  ", ".txt")


def test_txt_non_utf8_fallback():
    doc = extract("Café résumé naïve text".encode("cp1252") * 3, ".txt")
    assert "Café" in doc.segments[0].text


def test_clean_text_preserves_meaning():
    assert clean_text("exam-\nple  of text\r\n\r\n\r\n\r\nnext") == "example of text\n\nnext"
    assert "fi" in clean_text("ﬁnal")


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("../../etc/passwd", "passwd"),
        ("..\\..\\win\\evil.pdf", "evil.pdf"),
        ("a/b/c.txt", "c.txt"),
        ("bad\x00name.pdf", "badname.pdf"),
        ("", "document"),
        ("   ", "document"),
    ],
)
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_metadata_validation():
    ok = validate_metadata("paper.PDF", "application/pdf")
    assert ok.ext == ".pdf" and ok.internal_name.endswith(".pdf") and "paper" not in ok.internal_name
    with pytest.raises(ValidationFailed):
        validate_metadata("run.exe", "application/octet-stream")
    with pytest.raises(ValidationFailed):
        validate_metadata("a.pdf", "image/png")
    assert validate_metadata("a.md", "application/octet-stream").mime == "text/markdown"


def test_content_validation():
    with pytest.raises(ValidationFailed):
        validate_content(b"", ".txt", 100)
    with pytest.raises(PayloadTooLarge):
        validate_content(b"x" * 101, ".txt", 100)
    with pytest.raises(ValidationFailed):
        validate_content(b"MZ\x90\x00 not a pdf", ".pdf", 1000)
    with pytest.raises(ValidationFailed):
        validate_content(b"PK\x03\x04junk", ".docx", 1000)
    with pytest.raises(ValidationFailed):
        validate_content(b"abc\x00def", ".txt", 1000)
    validate_content(make_docx([("p", "hello world")]), ".docx", 10**6)
