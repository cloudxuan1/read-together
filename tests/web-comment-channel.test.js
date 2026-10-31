'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'books-web-chatgpt-'));
process.env.READING_DATA_DIR = dir;
process.env.READING_WEB_CHANNEL = 'chatgpt';
process.env.READING_PUSH_ENABLED = '0';
process.env.READING_PUSH_WEBHOOK = '';
process.env.READING_CHATGPT_CONTROL_TOKEN = 'chatgpt-test';
process.env.READING_MCP_CONTROL_TOKEN = 'codex-test';
const store = require('../lib/store');
const { server } = require('../server');
let base;
test.before(async () => {
  fs.mkdirSync(path.join(store.BOOKS_DIR, 'sample'), { recursive: true });
  store.writeJson(path.join(store.BOOKS_DIR, 'sample/manifest.json'), { bookId: 'sample', title: 'Sample', chapters: [] });
  store.writeAnnotations('sample', [
    { id: 'gpt-note', channel: 'chatgpt', createdBy: 'ai', comments: [] },
    { id: 'codex-note', channel: 'codex', createdBy: 'ai', comments: [] },
  ]);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});
test('web replies reach the configured ChatGPT channel while authentication and isolation remain enforced', async () => {
  const url = '/api/annotations/sample';
  assert.equal((await fetch(base + url)).status, 401);
  const headers = { 'x-guichao-home-authenticated': '1', 'content-type': 'application/json' };
  const notes = await (await fetch(base + url, { headers })).json();
  assert.deepEqual(notes.annotations.map(note => note.id), ['gpt-note']);
  const body = JSON.stringify({ author: 'human', text: 'A webpage reply', clientId: 'web-reply', delivery: 'home', source: 'codex' });
  const response = await fetch(base + url + '/gpt-note/comment', { method: 'POST', headers, body });
  assert.equal(response.status, 200);
  const { comment } = await response.json();
  assert.equal(comment.source, 'chatgpt');
  assert.equal(comment.delivery, undefined);
  const internal = base + '/api/internal/mcp/ui/annotations/sample';
  const read = await fetch(internal, { headers: { authorization: 'Bearer chatgpt-test' } });
  assert.equal((await read.json()).annotations[0].comments[0].text, 'A webpage reply');
  assert.equal((await fetch(internal, { headers: { authorization: 'Bearer codex-test' } })).status, 401);
  const retry = await fetch(base + url + '/gpt-note/comment', { method: 'POST', headers, body });
  assert.equal((await retry.json()).duplicate, true);
  assert.equal(store.readAnnotations('sample')[0].comments.length, 1);
});
