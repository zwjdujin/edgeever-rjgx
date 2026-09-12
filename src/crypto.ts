/**
 * crypto.ts —— 加密模式的核心
 *
 * 设计要点：
 * 1. 密码本身从不落盘，只保存 PBKDF2 的盐与一个"校验块"。
 * 2. 盐与校验块是公开信息（PBKDF2 本就设计成盐可公开），存放在笔记里，
 *    因此换设备后用同一个密码依然能解锁 —— 不需要依赖不跨设备的 Secret Storage。
 * 3. 派生出的 AES-GCM 密钥只存在于内存，关闭页面即消失，不写入任何持久化位置。
 */

export const KDF_ITERATIONS = 150_000;
const VERIFY_PLAINTEXT = 'EDGEEVER-SOCIAL-GRAPH-VAULT-OK';

export interface KdfMeta {
  v: number;
  kdf: string;
  iter: number;
  salt: string;
  verify: string;
}

function subtle(): SubtleCrypto {
  const c: any = (globalThis as any).crypto;
  if (!c || !c.subtle) {
    throw new Error('当前运行环境不支持 WebCrypto，无法启用加密模式。');
  }
  return c.subtle as SubtleCrypto;
}

/**
 * TS 5.7 起 Uint8Array 带 ArrayBufferLike 泛型，而 WebCrypto 要求 ArrayBufferView<ArrayBuffer>。
 * 这里的转换是安全的：我们从不使用 SharedArrayBuffer。
 */
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const c: any = (globalThis as any).crypto;
  const out = new Uint8Array(n);
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const s = subtle();
  const base = await s.importKey(
    'raw',
    bs(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return s.deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** AES-GCM 加密，输出 base64(iv[12] || ciphertext) */
export async function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bs(data)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}

/** 解密，失败返回 null（密码错误或数据损坏） */
export async function decryptBytes(key: CryptoKey, payload: string): Promise<Uint8Array | null> {
  try {
    const raw = b64decode(payload);
    if (raw.length <= 12) return null;
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, key, bs(ct));
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  return encryptBytes(key, new TextEncoder().encode(JSON.stringify(value)));
}

export async function decryptJson<T = unknown>(key: CryptoKey, payload: string): Promise<T | null> {
  const bytes = await decryptBytes(key, payload);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/** 首次设置密码：生成盐 + 校验块 */
export async function createVault(password: string): Promise<{ meta: KdfMeta; key: CryptoKey }> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const verify = await encryptBytes(key, new TextEncoder().encode(VERIFY_PLAINTEXT));
  return {
    meta: { v: 1, kdf: 'PBKDF2-SHA256', iter: KDF_ITERATIONS, salt: b64encode(salt), verify },
    key
  };
}

/** 用密码尝试解锁，密码错误返回 null */
export async function unlockVault(password: string, meta: KdfMeta): Promise<CryptoKey | null> {
  if (!meta || !meta.salt || !meta.verify) return null;
  const key = await deriveKey(password, b64decode(meta.salt), meta.iter || KDF_ITERATIONS);
  const pt = await decryptBytes(key, meta.verify);
  if (!pt) return null;
  return new TextDecoder().decode(pt) === VERIFY_PLAINTEXT ? key : null;
}

/** 粗粒度密码强度评估，用于界面提示 */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const s = Math.min(3, Math.max(0, score - 1)) as 0 | 1 | 2 | 3;
  return { score: s, label: ['弱', '一般', '较好', '很强'][s] };
}
