'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

test('a failing configured bridge preserves the comment and retries its notification without duplicates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'books-notification-'));
  let received = 0;
  const bridge = http.createServer((req, res) => { received++; req.resume(); res.writeHead(503); res.end(); });
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  process.env.READING_DATA_DIR = dir;
  process.env.READING_PUSH_WEBHOOK = `http://127.0.0.1:${bridge.address().port}`;
  const store = require('../lib/store');
  const { addCommentWithDelivery } = require('../server');
  try {
    fs.mkdirSync(path.join(store.BOOKS_DIR, 'sample'), { recursive: true });
    store.writeJson(path.join(store.BOOKS_DIR, 'sample/manifest.json'), { title: 'Sample' });
    store.writeAnnotations('sample', [{ id: 'note', channel: 'codex', createdBy: 'human', comments: [] }]);
    const body = { author: 'human', text: 'A saved reply', clientId: 'reply-1' };
    for (const retryDelivery of [false, true]) {
      const result = await addCommentWithDelivery('sample', 'note', { ...body, retryDelivery }, { wake: true });
      assert.equal(result.status, 200);
      assert.equal(result.json.comment.text, body.text);
      assert.equal(result.json.delivery.status, 'failed');
    }
    assert.equal(received, 2);
    assert.equal(store.readAnnotations('sample')[0].comments.length, 1);
  } finally {
    await new Promise(resolve => bridge.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
