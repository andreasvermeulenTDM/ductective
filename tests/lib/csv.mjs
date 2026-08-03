/**
 * csv.mjs — just enough CSV for data/manifest.csv.
 *
 * The manifest has quoted fields containing commas (model coverage strings), so
 * a naive split(',') mis-parses it. It does not have embedded newlines, so this
 * stays a line-oriented parser and nothing more. No dependency for 30 lines.
 */

function splitRow(line) {
  const out = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** @returns {{headers: string[], rows: Record<string,string>[]}} */
export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitRow(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']));
  });

  return { headers, rows };
}

/**
 * The join key for E1.1: the basename of SourceURL, URL-decoded.
 *
 * The story is explicit that reconciliation joins on SourceURL basename and NOT
 * on the FileName column — on-disk names are source names, and FileName is a
 * descriptive rename. Joining on the wrong column is the specific defect E1.1
 * exists to prevent, so it gets its own named function rather than an inline
 * expression somebody can quietly change.
 */
export function sourceBasename(sourceUrl) {
  if (!sourceUrl) return null;
  const withoutQuery = sourceUrl.split(/[?#]/)[0];
  const last = withoutQuery.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
