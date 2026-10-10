from app.ingestion.chunking import chunk_segments, chunk_text, count_tokens, split_sentences
from app.ingestion.extractors import Segment


def test_count_tokens_basic():
    assert count_tokens("Hello, world!") == 4
    assert count_tokens("") == 0
    assert count_tokens("internationalization") > 1  # long words count as several sub-tokens


def test_split_sentences():
    assert split_sentences("One. Two! Three?\nFour") == ["One.", "Two!", "Three?", "Four"]


def test_chunks_respect_size_and_overlap():
    text = " ".join(f"Sentence number {i} talks about topic {i % 7}." for i in range(200))
    chunks = chunk_text(text, size=60, overlap=15)
    assert len(chunks) > 5
    assert all(t <= 60 for _, t in chunks)
    # overlap: the start of each chunk repeats the tail of the previous one
    for (a, _), (b, _) in zip(chunks, chunks[1:], strict=False):
        assert a.split(". ")[-1].strip(". ") in b or b.split(".")[0] in a


def test_no_text_lost():
    sentences = [f"Fact {i} is important." for i in range(80)]
    chunks = chunk_text(" ".join(sentences), size=50, overlap=10)
    joined = " ".join(c for c, _ in chunks)
    assert all(s in joined for s in sentences)


def test_zero_overlap_has_no_repetition():
    sentences = [f"Unique statement {i}." for i in range(60)]
    chunks = chunk_text(" ".join(sentences), size=40, overlap=0)
    joined = " ".join(c for c, _ in chunks)
    assert joined.count("Unique statement 10.") == 1


def test_long_sentence_is_hard_split():
    text = " ".join(f"word{i}" for i in range(500))  # no punctuation
    chunks = chunk_text(text, size=50, overlap=5)
    assert len(chunks) >= 10 and all(t <= 50 for _, t in chunks)


def test_segments_keep_page_and_section():
    segs = [Segment("Alpha beta gamma. " * 40, page=1), Segment("Delta epsilon. " * 40, page=2, heading="Results")]
    chunks = chunk_segments(segs, size=40, overlap=8)
    assert {c.page for c in chunks} == {1, 2}
    assert all(c.section == "Results" for c in chunks if c.page == 2)
    assert [c.index for c in chunks] == list(range(len(chunks)))  # contiguous indices


def test_default_sizes_give_single_chunk_for_short_text():
    assert len(chunk_text("Short text. Two sentences.", 800, 120)) == 1
