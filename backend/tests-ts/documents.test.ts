import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDocument } from '../src/documents.js';
import { OpenAI } from '../src/provider.js';
import { settings } from '../src/config.js';

test('PDF extraction sends the file to OpenAI and preserves the full returned posting', async () => {
  const key = settings.openaiKey;
  settings.openaiKey = 'test-key';
  try {
    const extracted = { title: 'Engineer', company_name: 'Example', company_url: '', jd: 'Engineer\nRequired: JavaScript.\nResponsibilities: Build accessible interfaces.', readable: true, warnings: [] };
    const model = new OpenAI(async () => {}, async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.store, false);
      assert.equal(body.input[0].content[0].type, 'input_file');
      assert.equal(Buffer.from(body.input[0].content[0].file_data.split(',')[1], 'base64').toString(), '%PDF-1.4\nfixture');
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(extracted) }] }] }));
    });
    assert.deepEqual(await extractDocument(Buffer.from('%PDF-1.4\nfixture'), model), extracted);
  } finally { settings.openaiKey = key; }
});

test('PDF extraction rejects invalid, oversized and unreadable documents', async () => {
  await assert.rejects(extractDocument(Buffer.from('not a pdf')), /valid PDF/);
  const huge = Buffer.alloc(5_000_001); huge.write('%PDF-1.4');
  await assert.rejects(extractDocument(huge), /5 MB/);
  const unreadable = { json: async () => ({ readable: false, jd: '' }) } as unknown as OpenAI;
  await assert.rejects(extractDocument(Buffer.from('%PDF-1.4\nfixture'), unreadable), /complete job description/);
});
