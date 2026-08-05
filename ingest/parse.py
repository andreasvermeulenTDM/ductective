"""
parse.py — S11 + A2. Per-page text with column awareness, and a quality signal.

    python ingest/parse.py <pdf-path>            -> JSON on stdout

A2 closed the OCR branch: 24 of 25 documents have clean text layers and the
"low-text" Carrier pages are vector dimensional drawings with nothing to OCR. It
repointed S11's quality signal at the real failure instead:

    `pdftotext -layout` merges the two columns of an IOM page onto one line,
    producing fluent nonsense that embeds confidently and that no flag fixes.

That is the failure this file exists to prevent. A spliced line reads like English,
survives every downstream check, and yields a chunk whose text never appeared in
the manual — a citation to a page that does not say what the chunk claims.

So: detect the gutter, read each column separately, and report per page whether a
naive full-width read would have spliced it.
"""

import json
import sys

import pdfplumber

# Bumped whenever a change here alters extracted text. parse.mjs invalidates its
# cache on this, because a parser fix that a warm cache hides is not a fix.
PARSER_VERSION = 2

# A gutter must be this fraction of page width to count as a column separator.
MIN_GUTTER_FRAC = 0.035
# Columns are only plausible when the gutter sits near the middle of the page.
GUTTER_BAND = (0.35, 0.65)
# Below this, a page is a diagram or a cover — real text, just not much of it.
LOW_TEXT_CHARS = 400

# ---------------------------------------------------------------------------
# Word segmentation — D1
# ---------------------------------------------------------------------------
# pdfplumber's default `x_tolerance` is an absolute 3 points: characters closer
# together than that are treated as one word. Several documents here set inter-word
# spacing by glyph positioning rather than emitting a space character, at gaps under
# 3pt — so whole clauses fused into single tokens:
#
#     "Condensercoildirtyorrestricted. Cleancoilorremoverestriction."
#
# It reads as a parse curiosity and behaves as a retrieval failure. `to_tsvector`
# never emits `condenser`, `dirty` or `restriction` for that page, so lexical search
# cannot see the page at all, and the embedding of a fused token is not the
# embedding of its words. Measured on the live corpus: only 25% of chunks containing
# "trane" carried it as a delimited word, and 20% for "precedent".
#
# The ratio form scales the tolerance with font size instead of fixing it in points,
# which is what makes one setting correct across a 6pt table and a 14pt heading.
# Verified across the corpus: on documents that were already clean the token count
# is *identical* (313 -> 313, 566 -> 566, canary words unfragmented), and on the
# affected ones the fused tokens go to zero (48-50LC page 30: 187 -> 1059 tokens,
# 24 fused -> 0).
X_TOLERANCE_RATIO = 0.15

# An alphabetic run longer than this is not an English word. "Condensercoildirty-
# orrestricted" is 30 characters; the longest ordinary word in HVAC prose
# ("troubleshooting") is 15.
GLUED_TOKEN_CHARS = 18


def find_gutter(words):
    """
    The widest vertical band containing no word, inside the text block.

    Word-occupancy rather than whitespace: a two-column page has a band no word
    crosses, and a single-column page with indented text does not.

    Measured across the **text extent**, not the page box. Searching the page box
    finds the right margin — on a US Letter IOM that is a 54pt band at centre 0.96,
    wider than any real gutter, so every page looked single-column and every
    two-column page would have been spliced. The bug this file exists to prevent,
    reintroduced by the detector meant to catch it.
    """
    if not words:
        return None
    x0 = min(w["x0"] for w in words)
    x1 = max(w["x1"] for w in words)
    width = x1 - x0
    if width <= 0:
        return None

    # 1pt buckets are finer than any real gutter and cheap at this page size.
    cols = int(width) + 1
    occupied = bytearray(cols)
    for w in words:
        a = max(0, int(w["x0"] - x0))
        b = min(cols - 1, int(w["x1"] - x0))
        for i in range(a, b + 1):
            occupied[i] = 1

    best = None
    run_start = None
    for i in range(cols):
        if not occupied[i]:
            if run_start is None:
                run_start = i
        else:
            if run_start is not None:
                run = (run_start, i - 1)
                if best is None or (run[1] - run[0]) > (best[1] - best[0]):
                    best = run
                run_start = None
    if run_start is not None:
        run = (run_start, cols - 1)
        if best is None or (run[1] - run[0]) > (best[1] - best[0]):
            best = run

    if best is None:
        return None

    gap_w = best[1] - best[0]
    centre = (best[0] + best[1]) / 2 / width
    if gap_w < MIN_GUTTER_FRAC * width:
        return None
    if not (GUTTER_BAND[0] <= centre <= GUTTER_BAND[1]):
        return None
    return x0 + (best[0] + best[1]) / 2


def lines_from(words, tol=2.5):
    """Group words into visual lines, then read each left to right."""
    rows = []
    for w in sorted(words, key=lambda w: (round(w["top"], 1), w["x0"])):
        if rows and abs(rows[-1][0]["top"] - w["top"]) <= tol:
            rows[-1].append(w)
        else:
            rows.append([w])
    return [" ".join(x["text"] for x in sorted(r, key=lambda x: x["x0"])) for r in rows]


def count_glued(words):
    """
    Tokens too long to be words — the signal S11 was missing.

    The original quality metrics (char count, alpha ratio, two-column detection)
    are all blind to this failure: fused text has a *higher* alpha ratio than
    correct text, so the one signal that could have caught it pointed the wrong
    way. Counted here so a regression is visible rather than inferred later from
    bad retrieval.
    """
    return sum(1 for w in words if len(w["text"]) > GLUED_TOKEN_CHARS and w["text"].isalpha())


def parse_page(page):
    words = page.extract_words(
        use_text_flow=False, keep_blank_chars=False, x_tolerance_ratio=X_TOLERANCE_RATIO
    ) or []
    gutter = find_gutter(words)
    two_col = gutter is not None

    if two_col:
        left = [w for w in words if w["x1"] <= gutter]
        right = [w for w in words if w["x0"] >= gutter]
        # A word straddling the gutter belongs to whichever side holds more of it.
        for w in words:
            if w["x1"] > gutter > w["x0"]:
                (left if (gutter - w["x0"]) >= (w["x1"] - gutter) else right).append(w)
        text = "\n".join(lines_from(left) + lines_from(right))
    else:
        text = "\n".join(lines_from(words))

    text = text.strip()
    alpha = sum(c.isalpha() for c in text)
    return {
        "page": page.page_number,
        "text": text,
        "chars": len(text),
        "words": len(words),
        "alpha_ratio": round(alpha / len(text), 3) if text else 0.0,
        "two_column": two_col,
        # True when a naive full-width read WOULD have spliced this page. Not a
        # defect — a defect avoided. Reported so the count is visible rather than
        # assumed to be zero.
        "splice_avoided": two_col,
        "low_text": len(text) < LOW_TEXT_CHARS,
        "glued_tokens": count_glued(words),
    }


def parse(path):
    pages = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            try:
                pages.append(parse_page(page))
            except Exception as e:  # one bad page must not lose the document
                pages.append(
                    {
                        "page": page.page_number,
                        "text": "",
                        "chars": 0,
                        "words": 0,
                        "alpha_ratio": 0.0,
                        "two_column": False,
                        "splice_avoided": False,
                        "low_text": True,
                        "glued_tokens": 0,
                        "error": f"{type(e).__name__}: {e}",
                    }
                )

    usable = [p for p in pages if not p["low_text"]]
    total_words = sum(p["words"] for p in pages) or 1
    glued = sum(p.get("glued_tokens", 0) for p in pages)
    return {
        "pages": pages,
        "parser_version": PARSER_VERSION,
        "quality": {
            "page_count": len(pages),
            "glued_tokens": glued,
            # Fraction of all tokens that are fused runs. Expected to be 0.000 now;
            # anything above GLUED_RATIO_MAX in parse.mjs is a parser regression,
            # not a property of the document.
            "glued_ratio": round(glued / total_words, 4),
            "usable_pages": len(usable),
            "low_text_pages": len(pages) - len(usable),
            "two_column_pages": sum(p["two_column"] for p in pages),
            "error_pages": sum("error" in p for p in pages),
            "total_chars": sum(p["chars"] for p in pages),
            "mean_alpha_ratio": round(
                sum(p["alpha_ratio"] for p in usable) / len(usable), 3
            )
            if usable
            else 0.0,
        },
    }


if __name__ == "__main__":
    json.dump(parse(sys.argv[1]), sys.stdout)
