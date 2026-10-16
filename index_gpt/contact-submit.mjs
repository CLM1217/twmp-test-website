// No credentials or responses are stored. Only a verified Google confirmation is success.
export const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSeCq5vcCjQBlWITixdB8W5OQleXJGxmbHub3qq8zQ843B3NSA/viewform';
export const FORM_ACTION = FORM_URL.replace('/viewform', '/formResponse');
export const FIELD_MAP = Object.freeze({
  name: 'entry.588998168', email: 'entry.476214014', service: 'entry.1610329698',
  stage: 'entry.1646642689', description: 'entry.473479111', day: 'entry.1091995575'
});
export const DATE_ENTRY = '805813894';

export class ContactError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

export function validateInquiry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContactError('INVALID_INPUT', '請確認表單內容。', 400);
  const limits = { [FIELD_MAP.name]: 80, [FIELD_MAP.email]: 254, [FIELD_MAP.service]: 80,
    [FIELD_MAP.stage]: 100, [FIELD_MAP.description]: 1500, [FIELD_MAP.day]: 120,
    preferred_date: 10, contact_time: 80, custom_time: 120 };
  const values = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (input[key] != null && typeof input[key] !== 'string') throw new ContactError('INVALID_INPUT', '欄位格式不正確。', 400);
    values[key] = (input[key] || '').trim();
    if (values[key].length > limit) throw new ContactError('INVALID_INPUT', '欄位內容超過可填寫長度。', 400);
  }
  if (!values[FIELD_MAP.name] || !values[FIELD_MAP.description] || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[FIELD_MAP.email])) {
    throw new ContactError('INVALID_INPUT', '請填寫稱呼、有效的電子信箱與需求簡介。', 400);
  }
  if (!['企業內訓', '資料科學專案', '系統建置', '其他／希望先討論'].includes(values[FIELD_MAP.service])) {
    throw new ContactError('INVALID_INPUT', '請選擇需求類型。', 400);
  }
  if (values.contact_time === '其他時段' && !values.custom_time) throw new ContactError('INVALID_INPUT', '請補充方便聯絡的時間。', 400);
  if (values.preferred_date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(values.preferred_date);
    if (!match) throw new ContactError('INVALID_INPUT', '請選擇有效的指定日期。', 400);
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 1900 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new ContactError('INVALID_INPUT', '請選擇有效的指定日期。', 400);
    }
  }
  return values;
}

export function readFormMetadata(html) {
  const match = html.match(/(?:var\s+)?FB_(?:PUBLIC_)?LOAD_DATA_\s*=\s*([\s\S]*?);<\/script>/);
  if (!match) throw new ContactError('FORM_UNAVAILABLE', '目前無法讀取問卷設定，請稍後再試。');
  let data;
  try { data = JSON.parse(match[1]); } catch { throw new ContactError('FORM_CHANGED', '問卷設定需要重新核對。'); }
  const questions = data?.[1]?.[1];
  if (!Array.isArray(questions)) throw new ContactError('FORM_CHANGED', '問卷設定需要重新核對。');
  // q[0] is a question block ID. The actual entry ID is q[4][0][0].
  const entries = new Map(questions.map(q => [String(q?.[4]?.[0]?.[0]), q]));
  for (const field of Object.values(FIELD_MAP)) {
    const question = entries.get(field.slice(6));
    if (!question || ![0, 1].includes(question[3])) throw new ContactError('FORM_CHANGED', '問卷欄位已變動，請改用 Google 需求表單。');
  }
  const dateQuestion = entries.get(DATE_ENTRY);
  const dateOptions = dateQuestion?.[4]?.[0]?.[7];
  if (dateQuestion?.[3] !== 9 || !Array.isArray(dateOptions) || Boolean(dateOptions[0]) || !Boolean(dateOptions[1])) {
    throw new ContactError('FORM_CHANGED', '問卷日期題設定已變動，請改用 Google 需求表單。');
  }
  const token = html.match(/name="fbzx"\s+value="(-?\d+)"/)?.[1];
  if (!token) throw new ContactError('FORM_UNAVAILABLE', '目前無法取得問卷提交資訊。');
  return { token };
}

export function buildGooglePayload(values, metadata) {
  const body = new URLSearchParams();
  for (const field of Object.values(FIELD_MAP)) body.set(field, values[field]);
  const time = values.contact_time === '其他時段' ? values.custom_time : values.contact_time;
  body.set(FIELD_MAP.day, [values[FIELD_MAP.day], time && `聯絡時段（台北時間）：${time}`].filter(Boolean).join('；'));
  if (values.preferred_date) {
    const [year, month, day] = values.preferred_date.split('-');
    body.set(`entry.${DATE_ENTRY}_year`, String(Number(year)));
    body.set(`entry.${DATE_ENTRY}_month`, String(Number(month)));
    body.set(`entry.${DATE_ENTRY}_day`, String(Number(day)));
  }
  body.set('fvv', '1'); body.set('pageHistory', '0'); body.set('fbzx', metadata.token);
  return body;
}

export function isGoogleConfirmation(response, html) {
  let url;
  try { url = new URL(response.url); } catch { return false; }
  if (!response.ok || url.hostname !== 'docs.google.com' || url.pathname !== new URL(FORM_ACTION).pathname) return false;
  // Confirmation marker, not iframe load, HTTP 200 alone, or a no-cors opaque response.
  return /class=["'][^"']*\b(?:vHW8K|freebirdFormviewerViewResponseConfirmationMessage)\b[^"']*["']/.test(html)
    && !/id=["']mG61Hd["']/.test(html);
}

export async function submitInquiry(input, fetchImpl = fetch) {
  const values = validateInquiry(input);
  const formResponse = await fetchImpl(FORM_URL, { signal: AbortSignal.timeout(12000), redirect: 'follow' });
  if (!formResponse.ok || !formResponse.url.startsWith('https://docs.google.com/forms/')) throw new ContactError('FORM_UNAVAILABLE', 'Google 問卷目前無法使用，請稍後再試。');
  const metadata = readFormMetadata(await formResponse.text());
  const response = await fetchImpl(FORM_ACTION, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildGooglePayload(values, metadata).toString(), signal: AbortSignal.timeout(20000), redirect: 'follow'
  });
  if (!isGoogleConfirmation(response, await response.text())) {
    throw new ContactError('DELIVERY_UNCONFIRMED', '目前無法確認送出結果，內容已保留。請勿立即重複送出，可改以聯絡信箱向我們確認。');
  }
  return { ok: true, confirmed: true };
}
