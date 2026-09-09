import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocument } from '../src/documents.js';
import { Gemini } from '../src/provider.js';
import { settings } from '../src/config.js';

test('PDF extraction sends the file to Gemini and preserves the full returned posting', async () => {
  const key = settings.geminiKey;
  settings.geminiKey = 'test-key';
  try {
    const extracted = { title: 'Engineer', company_name: 'Example', company_url: '', jd: 'Engineer\nRequired: JavaScript.\nResponsibilities: Build accessible interfaces.', readable: true, warnings: [] };
    const model = new Gemini(async () => {}, async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const parts = body.contents[0].parts;
      assert.equal(parts[0].inline_data.mime_type, 'application/pdf');
      assert.equal(Buffer.from(parts[0].inline_data.data, 'base64').toString(), '%PDF-1.4\nfixture');
      assert.match(parts[1].text, /output_schema/);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(extracted) }] } }] }));
    });
    assert.deepEqual(await extractDocument(Buffer.from('%PDF-1.4\nfixture'), model), extracted);
  } finally { settings.geminiKey = key; }
});

test('PDF extraction rejects invalid, oversized and unreadable documents', async () => {
  await assert.rejects(extractDocument(Buffer.from('not a pdf')), /valid PDF/);
  const huge = Buffer.alloc(5_000_001); huge.write('%PDF-1.4');
  await assert.rejects(extractDocument(huge), /5 MB/);
  const unreadable = { json: async () => ({ readable: false, jd: '' }) } as unknown as Gemini;
  await assert.rejects(extractDocument(Buffer.from('%PDF-1.4\nfixture'), unreadable), /complete job description/);
});
