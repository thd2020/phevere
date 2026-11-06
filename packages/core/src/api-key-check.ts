/**
 * Settings → API keys: one small real request per provider to tell a working key
 * from a rejected one. Keys and secrets go only into the request itself; nothing
 * here logs them, and failure messages never repeat them.
 */

import type { HttpClient, HttpTextResponse } from './http';
import { t } from './i18n/runtime';

export type ApiProviderId = 'google' | 'deepl' | 'youdao' | 'oxford' | 'wordsapi' | 'collins';

export interface ApiCredentials {
  googleKey?: string | null;
  deeplKey?: string | null;
  youdaoKey?: string | null;
  youdaoSecret?: string | null;
  oxfordId?: string | null;
  oxfordKey?: string | null;
  wordsKey?: string | null;
  wordsHost?: string | null;
  collinsKey?: string | null;
  collinsHost?: string | null;
}

export interface ApiKeyCheck {
  ok: boolean;
  message: string;
}

const TIMEOUT_MS = 9000;

/** First sentence of a provider's JSON error, cut short; never contains what we sent. */
function errorText(res: HttpTextResponse): string {
  try {
    const j = JSON.parse(res.text);
    const msg = j?.error?.message || j?.message || j?.error_description || (typeof j?.error === 'string' ? j.error : '');
    if (msg) return String(msg).split(/(?<=\.)\s/)[0].slice(0, 140);
  } catch {
    /* not JSON */
  }
  return t('settings.keys.check.httpStatus', { status: String(res.status) });
}

async function get(
  http: HttpClient,
  url: string,
  headers: Record<string, string> | undefined,
  host: string,
): Promise<HttpTextResponse | ApiKeyCheck> {
  try {
    return await http.requestText(url, { headers, timeoutMs: TIMEOUT_MS });
  } catch {
    return { ok: false, message: t('settings.keys.check.unreachable', { host }) };
  }
}

const isCheck = (r: HttpTextResponse | ApiKeyCheck): r is ApiKeyCheck => !('status' in r);

/** 2xx means the key works; a dictionary 404 means the key passed and the test word was missing. */
function judge(res: HttpTextResponse, notFoundIsOk = false): ApiKeyCheck {
  if (res.ok || (notFoundIsOk && res.status === 404)) return { ok: true, message: t('settings.keys.check.works') };
  if (res.status === 429) return { ok: false, message: t('settings.keys.check.rateLimited') };
  return { ok: false, message: errorText(res) };
}

export async function checkApiKey(
  http: HttpClient,
  provider: ApiProviderId,
  c: ApiCredentials,
  sha256Hex?: (s: string) => string | Promise<string>,
): Promise<ApiKeyCheck> {
  const missing: ApiKeyCheck = { ok: false, message: t('settings.keys.check.noKey') };
  switch (provider) {
    case 'google': {
      if (!c.googleKey) return missing;
      const r = await get(
        http,
        `https://translation.googleapis.com/language/translate/v2/languages?target=en&key=${encodeURIComponent(c.googleKey)}`,
        undefined,
        'translation.googleapis.com',
      );
      return isCheck(r) ? r : judge(r);
    }
    case 'deepl': {
      if (!c.deeplKey) return missing;
      // The same endpoint Phevere translates through.
      const r = await get(
        http,
        'https://api-free.deepl.com/v2/usage',
        { Authorization: `DeepL-Auth-Key ${c.deeplKey}` },
        'api-free.deepl.com',
      );
      if (isCheck(r)) return r;
      if (r.status === 403) return { ok: false, message: t('settings.keys.check.deeplRejected') };
      return judge(r);
    }
    case 'youdao': {
      if (!c.youdaoKey || !c.youdaoSecret) return { ok: false, message: t('settings.keys.check.youdaoBothNeeded') };
      if (!sha256Hex) return { ok: false, message: t('settings.keys.check.cannotSign') };
      const q = 'hello';
      const salt = String(Date.now());
      const curtime = String(Math.round(Date.now() / 1000));
      const sign = await Promise.resolve(sha256Hex(`${c.youdaoKey}${q}${salt}${curtime}${c.youdaoSecret}`));
      const body = new URLSearchParams({ q, from: 'en', to: 'zh-CHS', appKey: c.youdaoKey, salt, sign, signType: 'v3', curtime });
      let r: HttpTextResponse;
      try {
        r = await http.requestText('https://openapi.youdao.com/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          timeoutMs: TIMEOUT_MS,
        });
      } catch {
        return { ok: false, message: t('settings.keys.check.unreachable', { host: 'openapi.youdao.com' }) };
      }
      let code = '';
      try {
        code = String(JSON.parse(r.text)?.errorCode ?? '');
      } catch {
        return judge(r);
      }
      if (code === '0') return { ok: true, message: t('settings.keys.check.works') };
      if (code === '108') return { ok: false, message: t('settings.keys.check.youdaoUnknownKey') };
      if (code === '202') return { ok: false, message: t('settings.keys.check.youdaoSignature') };
      return { ok: false, message: t('settings.keys.check.youdaoError', { code: code || String(r.status) }) };
    }
    case 'oxford': {
      if (!c.oxfordId || !c.oxfordKey) return { ok: false, message: t('settings.keys.check.oxfordBothNeeded') };
      const r = await get(
        http,
        'https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/test',
        { app_id: c.oxfordId, app_key: c.oxfordKey },
        'od-api.oxforddictionaries.com',
      );
      return isCheck(r) ? r : judge(r, true);
    }
    case 'wordsapi': {
      if (!c.wordsKey) return missing;
      const host = c.wordsHost || 'wordsapiv1.p.rapidapi.com';
      const r = await get(http, `https://${host}/words/test`, { 'X-RapidAPI-Key': c.wordsKey, 'X-RapidAPI-Host': host }, host);
      return isCheck(r) ? r : judge(r, true);
    }
    case 'collins': {
      if (!c.collinsKey || !c.collinsHost) return { ok: false, message: t('settings.keys.check.collinsBothNeeded') };
      const host = c.collinsHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const r = await get(
        http,
        `https://${host}/api/v1/dictionaries/english/entries/test`,
        { 'X-RapidAPI-Key': c.collinsKey, 'X-RapidAPI-Host': host },
        host,
      );
      return isCheck(r) ? r : judge(r, true);
    }
    default:
      return { ok: false, message: t('settings.keys.check.unknownProvider') };
  }
}
