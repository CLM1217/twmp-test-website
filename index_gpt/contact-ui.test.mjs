import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('./index_gpt_1.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).filter(Boolean).join('\n');
new vm.Script(script);
const source = script.slice(script.indexOf('    // 聯絡表單：'), script.indexOf('    // 介紹影片：'));

test('actual HTML controls use all six entry names and preserve the page description', () => {
  const form = html.match(/<form id="inquiry-form"[\s\S]*?<\/form>/)[0];
  const ids = { 'inquiry-name': '588998168', 'inquiry-email': '476214014', 'inquiry-service': '1610329698', 'inquiry-stage': '1646642689', 'inquiry-description': '473479111', 'inquiry-day': '1091995575' };
  for (const [id, entry] of Object.entries(ids)) assert.match(form, new RegExp(`<(?:input|select|textarea) id="${id}" name="entry\\.${entry}"`));
  assert.match(html, /<meta name="description"/);
  assert.doesNotMatch(form, /name="entry\.805813894"/);
  assert.match(form, /name="preferred_date" type="date"/);
});

function harness({ result = { ok: true, confirmed: true }, protocol = 'http:', request } = {}) {
  function element(value = '') {
    return { value, hidden: false, disabled: false, required: false, error: '', listeners: {}, dataset: {}, style: {},
      classList: { add() {}, remove() {} }, setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
      addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
      async fire(type, extra = {}) { const event = { target: this, preventDefault() {}, ...extra }; for (const callback of this.listeners[type] || []) await callback(event); },
      setCustomValidity(message) { this.error = message; }, focus() { this.focused = true; }, select() { this.selected = true; }
    };
  }
  const ids = Object.fromEntries(['inquiry-form', 'inquiry-fields', 'inquiry-submit', 'inquiry-time', 'inquiry-custom-time-field', 'inquiry-custom-time', 'inquiry-feedback', 'inquiry-copy', 'inquiry-copy-text', 'inquiry-success', 'inquiry-copy-button', 'inquiry-name', 'inquiry-description', 'request-form-title'].map(id => [id, element()]));
  ids['inquiry-name'].value = '測試'; ids['inquiry-description'].value = '資料專案需求'; ids['inquiry-time'].value = '上午 09:00–12:00';
  const root = element(); root.style = { overflow: 'auto', paddingRight: '2px' }; root.clientWidth = 1425;
  const closeButton = element(); const dialog = ids['inquiry-success']; dialog.querySelectorAll = () => [closeButton];
  dialog.open = false; dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; void dialog.fire('close'); };
  dialog.getBoundingClientRect = () => ({ left: 200, right: 700, top: 100, bottom: 600 });
  const form = ids['inquiry-form']; form.action = 'http://127.0.0.1:4173/api/contact';
  form.reportValidity = () => !Object.values(ids).some(el => el.error && !el.disabled);
  const payload = { 'entry.588998168': '測試', 'entry.476214014': 'person@example.com', 'entry.1610329698': '企業內訓', 'entry.1646642689': '需求規劃中', 'entry.473479111': '資料專案需求', 'entry.1091995575': '平日', contact_time: '上午 09:00–12:00', preferred_date: '2028-02-29' };
  class FakeFormData { *[Symbol.iterator]() { yield* Object.entries({ ...payload, contact_time: ids['inquiry-time'].value, custom_time: ids['inquiry-custom-time'].value }); } }
  const calls = [];
  vm.runInNewContext(source, {
    document: { getElementById: id => ids[id], documentElement: root },
    window: { innerWidth: 1440, location: { protocol } },
    getComputedStyle: node => node === root ? { paddingRight: '2px' } : { opacity: '1', transform: 'none' },
    motionMedia: { matches: true, addEventListener() {} }, FormData: FakeFormData,
    navigator: {}, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { calls.push({ url, options }); return request ? request() : { ok: true, json: async () => result }; }
  });
  return { ids, form, dialog, root, calls, closeButton };
}

test('verified success opens native branded dialog without navigation; preserves entered data', async () => {
  const h = harness(); await h.form.fire('submit');
  assert.equal(h.calls[0].url, 'http://127.0.0.1:4173/api/contact');
  const body = JSON.parse(h.calls[0].options.body); assert.equal(body.preferred_date, '2028-02-29');
  assert.equal(h.dialog.open, true); assert.equal(h.root.style.overflow, 'hidden');
  assert.equal(h.ids['inquiry-submit'].disabled, true); assert.equal(h.ids['inquiry-fields'].disabled, false);
  assert.equal(h.ids['inquiry-description'].value, '資料專案需求');
  await h.form.fire('submit'); assert.equal(h.calls.length, 1);
  await h.closeButton.fire('click'); assert.equal(h.dialog.open, false); assert.equal(h.root.style.overflow, 'auto');
  assert.equal(h.ids['request-form-title'].focused, true);
  await h.form.fire('input', { target: h.ids['inquiry-name'] }); assert.equal(h.ids['inquiry-submit'].disabled, false);
  assert.equal(source.includes('location.assign'), false);
});
test('unconfirmed or malformed response never shows success and keeps a copy of input', async () => {
  for (const result of [{ ok: false, message: '無法確認送出結果' }, { ok: true }]) {
    const h = harness({ result }); await h.form.fire('submit');
    assert.equal(h.dialog.open, false); assert.equal(h.ids['inquiry-copy'].hidden, false);
    assert.match(h.ids['inquiry-copy-text'].value, /資料專案需求/); assert.equal(h.ids['inquiry-fields'].disabled, false);
  }
  const h = harness({ request: async () => ({ ok: true, json: async () => { throw Error('HTML, not JSON'); } }) });
  await h.form.fire('submit'); assert.equal(h.dialog.open, false); assert.match(h.ids['inquiry-feedback'].textContent, /無法確認/);
});
test('pending request cannot be duplicated', async () => {
  let resolve;
  const h = harness({ request: () => new Promise(done => { resolve = done; }) });
  const first = h.form.fire('submit');
  assert.equal(h.ids['inquiry-fields'].disabled, true);
  await h.form.fire('submit'); assert.equal(h.calls.length, 1);
  resolve({ ok: true, json: async () => ({ ok: true, confirmed: true }) }); await first;
  assert.equal(h.dialog.open, true);
});
test('file URL and invalid custom time do not attempt submission or claim success', async () => {
  const h = harness({ protocol: 'file:' }); await h.form.fire('submit');
  assert.equal(h.calls.length, 0); assert.equal(h.dialog.open, false); assert.equal(h.ids['inquiry-copy'].hidden, false);
  const custom = harness(); custom.ids['inquiry-time'].value = '其他時段'; await custom.ids['inquiry-time'].fire('change');
  await custom.form.fire('submit'); assert.equal(custom.calls.length, 0); assert.ok(custom.ids['inquiry-custom-time'].error);
});
