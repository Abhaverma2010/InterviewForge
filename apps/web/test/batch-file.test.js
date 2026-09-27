import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBatchFile, parseCsv } from '../lib/batch-file.js';

describe('parseBatchFile', () => {
  test('reads the evaluator’s JSON format', () => {
    const text = JSON.stringify([
      { id: 'case-01', jd: 'Backend Engineer\n- Go', company_url: 'https://acme.com', days: 5 },
    ]);
    const { items, errors } = parseBatchFile('cases.json', text);
    assert.deepEqual(errors, []);
    assert.deepEqual(items, [{ jd: 'Backend Engineer\n- Go', company_url: 'https://acme.com', days: 5 }]);
  });

  test('reads CSV with quoted multi-line descriptions and fills missing days', () => {
    const csv =
      'jd,company_url,days\n"Senior Engineer\n- Go, Rust\n- ""Clear"" writing",acme.com,\nFrontend dev,https://b.io,3\n';
    const { items, errors } = parseBatchFile('roles.csv', csv, { defaultDays: 7 });
    assert.deepEqual(errors, []);
    assert.equal(items[0].jd, 'Senior Engineer\n- Go, Rust\n- "Clear" writing');
    assert.equal(items[0].days, 7);
    assert.equal(items[1].days, 3);
  });

  test('reports row problems and keeps the valid rows', () => {
    const text = JSON.stringify([
      { jd: '', company_url: 'https://a.com', days: 2 },
      { jd: 'Dev', company_url: 'https://b.com', days: 0 },
      { jd: 'Dev', company_url: 'https://c.com', days: 4 },
    ]);
    const { items, errors } = parseBatchFile('x.json', text);
    assert.equal(items.length, 1);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /Row 1/);
  });

  test('explains unusable files', () => {
    assert.match(parseBatchFile('x.json', '{not json').errors[0], /not valid JSON/);
    assert.match(parseBatchFile('x.json', '{"a":1}').errors[0], /array/);
    assert.match(parseBatchFile('x.csv', 'a,b\n1,2').errors[0], /header row/);
  });

  test('limits the batch size', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      jd: `Role ${i}`,
      company_url: 'https://a.com',
      days: 3,
    }));
    const { items, errors } = parseBatchFile('x.json', JSON.stringify(many));
    assert.equal(items.length, 10);
    assert.match(errors[0], /At most 10/);
  });
});

describe('parseCsv', () => {
  test('handles CRLF line endings and a byte-order mark', () => {
    assert.deepEqual(parseCsv('﻿jd,days\r\nA,1\r\nB,2\r\n'), [
      { jd: 'A', days: '1' },
      { jd: 'B', days: '2' },
    ]);
  });
});
