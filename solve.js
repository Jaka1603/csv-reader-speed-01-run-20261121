// csv-reader-speed: a fast drop-in for csv-reader 1.0.0.
//
// run(input) returns exactly csv-reader 1.0.0's answer for {text, header}:
// {columns, rows, errors} under its broken-row policy (BOM dropped, records end
// at LF or CRLF, empty lines are no records, stray CRs dropped, quoted fields
// with "" escapes and CR/CRLF read as LF, quote junk appended, an unterminated
// quote read again as unquoted, rows padded or cut to the first record's width).
//
// Where the reference builds every field a character at a time, this reader
// finds field boundaries with indexOf and charCodeAt scans and cuts each field
// out with one slice(). Segment-by-segment paths survive only where the policy
// needs them: stray CRs inside a field, junk after a closing quote, the
// re-read after an unterminated quote, and CR normalization inside quotes.

const COMMA = 0;
const BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // Reads an unquoted field body starting at `start`, the value so far being
  // `prefix` ('' for a plain field, '"' after an unterminated quote, the
  // quoted value for quote junk). A CR not followed by LF is dropped
  // (stray_cr). Returns the field, how it ended, and how many characters were
  // kept from the text (the quote_junk test). Off the hot path.
  function readUnquotedFrom(start, prefix) {
    let value = prefix;
    let added = 0;
    let seg = start;
    let i = start;
    while (i < n) {
      const ci = text.indexOf(',', i);
      const ni = text.indexOf('\n', i);
      const ri = text.indexOf('\r', i);
      let m = ci;
      if (ni !== -1 && (m === -1 || ni < m)) m = ni;
      if (ri !== -1 && (m === -1 || ri < m)) m = ri;
      if (m === -1) break;
      if (m === ri && text.charCodeAt(m + 1) !== 10) {
        value += text.slice(seg, m);
        added += m - seg;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        i = m + 1;
        seg = i;
        continue;
      }
      value += text.slice(seg, m);
      added += m - seg;
      if (m === ci) {
        pos = m + 1;
        return { value, ended: COMMA, added };
      }
      pos = m === ri ? m + 2 : m + 1;
      line += 1;
      return { value, ended: BREAK, added };
    }
    value += text.slice(seg, n);
    added += n - seg;
    pos = n;
    return { value, ended: END, added };
  }

  // The quoted content in text[a..b): returns [value, lines] with each CRLF
  // or lone CR read as one LF, and lines the number of line breaks inside.
  function cleanSegment(a, b) {
    let lines = 0;
    let hasCR = false;
    for (let j = a; j < b; j++) {
      const c = text.charCodeAt(j);
      if (c === 10) lines += 1;
      else if (c === 13) {
        hasCR = true;
        break;
      }
    }
    if (!hasCR) return [text.slice(a, b), lines];
    let out = '';
    lines = 0;
    let seg = a;
    let i = a;
    while (i < b) {
      const c = text.charCodeAt(i);
      if (c === 13) {
        out += text.slice(seg, i) + '\n';
        lines += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
        seg = i;
      } else {
        if (c === 10) lines += 1;
        i += 1;
      }
    }
    out += text.slice(seg, b);
    return [out, lines];
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let ended = END;

    do {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const open = pos;
        // One pass over the quoted content: find the closing quote (a quote
        // that is not doubled), note the doubled-quote split points, count
        // the LF line breaks, and flag any CR (a CR sends the value build to
        // cleanSegment, which reads each CRLF or lone CR as one LF).
        let i = open + 1;
        let splits = null;
        let lfCount = 0;
        let crFlag = false;
        let closeQ = -1;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              if (splits === null) splits = [i];
              else splits.push(i);
              i += 2;
              continue;
            }
            closeQ = i;
            break;
          }
          if (c === 10) lfCount += 1;
          else if (c === 13) {
            crFlag = true;
            if (text.charCodeAt(i + 1) === 10) i += 1;
          }
          i += 1;
        }
        if (closeQ === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquotedFrom(open + 1, '"');
          fields.push(r.value);
          ended = r.ended;
          continue;
        }
        let value;
        if (splits === null && !crFlag) {
          value = text.slice(open + 1, closeQ);
          line += lfCount;
        } else if (!crFlag) {
          const parts = [];
          let s = open + 1;
          for (const sp of splits) {
            parts.push(text.slice(s, sp), '"');
            s = sp + 2;
          }
          parts.push(text.slice(s, closeQ));
          value = parts.join('');
          line += lfCount;
        } else {
          const parts = [];
          let s = open + 1;
          let dl = 0;
          const ends = splits === null ? [closeQ] : splits.concat(closeQ);
          for (const sp of ends) {
            const seg = cleanSegment(s, sp);
            dl += seg[1];
            parts.push(seg[0]);
            if (sp !== closeQ) parts.push('"');
            s = sp + 2;
          }
          value = parts.join('');
          line += dl;
        }
        pos = closeQ + 1;
        if (pos >= n) {
          fields.push(value);
          ended = END;
          continue;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          pos += 1;
          fields.push(value);
          ended = COMMA;
          continue;
        }
        if (c === 10) {
          pos += 1;
          line += 1;
          fields.push(value);
          ended = BREAK;
          continue;
        }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          fields.push(value);
          ended = BREAK;
          continue;
        }
        // What follows the closing quote is appended as it stands, up to the
        // next comma or line break (quote_junk, when anything was appended).
        const junk = readUnquotedFrom(pos, value);
        if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(junk.value);
        ended = junk.ended;
        continue;
      }

      lastQuoted = false;
      // An unquoted field: scan to the next comma or line break and cut it
      // out whole. A lone CR inside sends it to the segment reader instead.
      const start = pos;
      let i = pos;
      let stray = false;
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10) break;
        if (c === 13) {
          if (text.charCodeAt(i + 1) === 10) break;
          stray = true;
          break;
        }
        i += 1;
      }
      if (stray) {
        const r = readUnquotedFrom(start, '');
        fields.push(r.value);
        ended = r.ended;
        continue;
      }
      fields.push(i === start ? '' : text.slice(start, i));
      if (i >= n) {
        pos = n;
        ended = END;
      } else if (text.charCodeAt(i) === 44) {
        pos = i + 1;
        ended = COMMA;
      } else if (text.charCodeAt(i) === 10) {
        pos = i + 1;
        line += 1;
        ended = BREAK;
      } else {
        pos = i + 2;
        line += 1;
        ended = BREAK;
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
