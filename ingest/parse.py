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

# A gutter must be this fraction of page width to count as a column separator.
MIN_GUTTER_FRAC = 0.035
# Columns are only plausible when the gutter sits near the middle of the page.
GUTTER_BAND = (0.35, 0.65)
# Below this, a page is a diagram or a cover — real text, just not much of it.
LOW_TEXT_CHARS = 400


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


def parse_page(page):
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False) or []
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
                        "error": f"{type(e).__name__}: {e}",
                    }
                )

    usable = [p for p in pages if not p["low_text"]]
    return {
        "pages": pages,
        "quality": {
            "page_count": len(pages),
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
