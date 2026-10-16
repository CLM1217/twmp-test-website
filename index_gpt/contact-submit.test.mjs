import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { FORM_URL, FORM_ACTION, FIELD_MAP, DATE_ENTRY, validateInquiry, readFormMetadata, buildGooglePayload, isGoogleConfirmation, submitInquiry } from './contact-submit.mjs';
import { server } from './server.mjs';

const valid = () => ({
  [FIELD_MAP.name]: ' 測試者 ', [FIELD_MAP.email]: 'inquiry+test@example.com',
  [FIELD_MAP.service]: '企業內訓', [FIELD_MAP.stage]: '需求規劃中',
  [FIELD_MAP.description]: 'Python & SQL\n資料 A+B #分析', [FIELD_MAP.day]: '平日（週一至週五）',
  preferred_date: '2028-02-29', contact_time: '其他時段', custom_time: '週三下午 15:00 後'
});
function fixture({ includesTime = 0, includesYear = 1 } = {}) {
  const questions = Object.values(FIELD_MAP).map((entry, i) => [9000000000 + i, `題目 ${i}`, null, i === 4 ? 1 : 0, [[Number(entry.slice(6)), null, 0]]]);
  questions.push([1855950598, '適合聯絡的日期時間', null, 9, [[Number(DATE_ENTRY), null, 0, null, null, null, null, [includesTime, includesYear]]]]);
  return `<script>var FB_PUBLIC_LOAD_DATA_=${JSON.stringify([null, [null, questions]])};</script><input type="hidden" name="fbzx" value="-123456">`;
}
function reply(url, html, ok = true) { return { url, ok, text: async () => html }; }

test('metadata uses nested input IDs, not question block IDs; checks date flags', () => {
  assert.equal(readFormMetadata(fixture()).token, '-123456');
  assert.throws(() => readFormMetadata(fixture({ includesTime: 1 })), error => error.code === 'FORM_CHANGED');
  assert.throws(() => readFormMetadata(fixture({ includesYear: 0 })), error => error.code === 'FORM_CHANGED');
  assert.throws(() => readFormMetadata('<html>登入</html>'));
});
test('date is split into year/month/day; no base date string or hour fields', () => {
  const body = buildGooglePayload(validateInquiry(valid()), readFormMetadata(fixture()));
  assert.equal(body.get('entry.805813894_year'), '2028');
  assert.equal(body.get('entry.805813894_month'), '2');
  assert.equal(body.get('entry.805813894_day'), '29');
  assert.equal(body.has('entry.805813894'), false);
  assert.equal(body.has('entry.805813894_hour'), false);
  assert.equal(body.has('entry.1855950598_year'), false);
  assert.match(body.get(FIELD_MAP.day), /週三下午 15:00 後/);
  assert.equal(body.get(FIELD_MAP.description), 'Python & SQL\n資料 A+B #分析');
  const input = valid(); input.preferred_date = ''; input['entry.805813894'] = 'untrusted';
  assert.equal(buildGooglePayload(validateInquiry(input), { token: '1' }).has('entry.805813894_year'), false);
});
test('invalid date/email, whitespace and missing custom time are rejected before network access', async () => {
  for (const patch of [{ preferred_date: '2026-02-29' }, { preferred_date: '2026-13-01' }, { [FIELD_MAP.email]: 'bad' }, { [FIELD_MAP.name]: '   ' }, { custom_time: '' }]) {
    let calls = 0;
    await assert.rejects(submitInquiry({ ...valid(), ...patch }, async () => { calls++; }), error => error.status === 400);
    assert.equal(calls, 0);
  }
});
test('HTTP 200, login pages, validation pages and opaque responses are not confirmation', () => {
  assert.equal(isGoogleConfirmation(reply(FORM_ACTION, ''), '<html>error</html>'), false);
  assert.equal(isGoogleConfirmation(reply(FORM_ACTION, ''), '<div class="vHW8K">訊息</div><form id="mG61Hd">'), false);
  assert.equal(isGoogleConfirmation(reply('https://accounts.google.com/Login', ''), '<div class="vHW8K">訊息</div>'), false);
  assert.equal(isGoogleConfirmation({ ok: true, url: '' }, '<div class="vHW8K">訊息</div>'), false);
  assert.equal(isGoogleConfirmation(reply(FORM_ACTION, ''), '<div class="vHW8K">自訂確認訊息</div>'), true);
});
test('proxy performs one validated POST and returns success only for confirmed Google response', async () => {
  const calls = [];
  const result = await submitInquiry(valid(), async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? reply(FORM_URL, fixture()) : reply(FORM_ACTION, '<div class="vHW8K">已收到</div>');
  });
  assert.deepEqual(result, { ok: true, confirmed: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'POST');
  const params = new URLSearchParams(calls[1].options.body);
  assert.equal(params.get(FIELD_MAP.name), '測試者');
  assert.equal(params.get('fbzx'), '-123456');
  let count = 0;
  await assert.rejects(submitInquiry(valid(), async () => ++count === 1 ? reply(FORM_URL, fixture()) : reply(FORM_ACTION, '<form id="mG61Hd">請修正</form>')), error => error.code === 'DELIVERY_UNCONFIRMED');
  assert.equal(count, 2); // No automatic retry of a potentially delivered response.
});
test('local preview serves page/video ranges and rejects cross-origin/invalid POST without contacting Google', async () => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /需求已送出，我們將盡快與您聯絡！/);
    const range = await fetch(`${base}/assets/introduction.mp4`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
    assert.equal((await fetch(`${base}/contact-submit.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/api/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: '{}' })).status, 403);
    const invalid = await fetch(`${base}/api/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).ok, false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
