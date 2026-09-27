// Reads an uploaded file of roles to prepare for. Accepted formats:
//   JSON  an array of { jd, company_url, days } (the same shape as the batch
//         evaluator's input file, so one file works in both places)
//   CSV   a header row with jd, company_url and optionally days; fields with
//         commas, quotes or line breaks must be quoted, as spreadsheets do
// Rows without days use `defaultDays`. Returns { items, errors }.

export const MAX_BATCH = 10;

export function parseBatchFile(name, text, { defaultDays = 7 } = {}) {
  let rows;
  try {
    rows = /\.json$/i.test(name) || text.trim().startsWith('[') ? parseJson(text) : parseCsv(text);
  } catch (err) {
    return { items: [], errors: [err.message] };
  }

  const items = [];
  const errors = [];
  rows.forEach((row, i) => {
    const label = `Row ${i + 1}`;
    const jd = String(row.jd ?? row.job_description ?? '').trim();
    const companyUrl = String(row.company_url ?? row.company ?? row.url ?? '').trim();
    const rawDays = row.days === undefined || row.days === '' ? defaultDays : Number(row.days);
    if (!jd) errors.push(`${label}: the job description (jd) is empty.`);
    if (!companyUrl) errors.push(`${label}: the company_url is empty.`);
    if (!Number.isInteger(rawDays) || rawDays < 1 || rawDays > 365) {
      errors.push(`${label}: days must be a whole number from 1 to 365.`);
    }
    if (jd && companyUrl && Number.isInteger(rawDays) && rawDays >= 1 && rawDays <= 365) {
      items.push({ jd, company_url: companyUrl, days: rawDays });
    }
  });
  if (items.length > MAX_BATCH) {
    errors.push(`At most ${MAX_BATCH} roles at a time; the file has ${items.length}.`);
  }
  if (!rows.length) errors.push('The file has no rows.');
  return { items: items.slice(0, MAX_BATCH), errors };
}

function parseJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (!Array.isArray(data)) throw new Error('The JSON file must contain an array of roles.');
  return data.map((row) => (row && typeof row === 'object' ? row : {}));
}

/** RFC 4180 CSV: quoted fields may contain commas, quotes ("") and line breaks. */
export function parseCsv(text) {
  const records = [];
  let field = '';
  let record = [];
  let quoted = false;
  const src = text.replace(/^﻿/, ''); // Excel's byte-order mark

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field || record.length) {
    record.push(field);
    records.push(record);
  }
  if (quoted) throw new Error('The CSV file has an unclosed quote.');

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim()));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  if (!header.includes('jd') && !header.includes('job_description')) {
    throw new Error('The CSV needs a header row with columns jd, company_url and days.');
  }
  return nonEmpty.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
}
