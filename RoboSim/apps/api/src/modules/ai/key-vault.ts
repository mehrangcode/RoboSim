import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption of provider keys (FR-AI-04, Security §7): every key gets its own data key (AES-256-GCM),
 * and only the wrapped data key is stored. The wrapper is the KMS port: OpenBao Transit in staging and production,
 * a local key-encryption key (`AI_KEK`) in development and tests.
 */
export interface KeyWrapper {
  wrap(dek: Buffer): Promise<string>;
  unwrap(wrapped: string): Promise<Buffer>;
}

export const KEY_WRAPPER = Symbol('KEY_WRAPPER');

const VERSION = 'v1';

function seal(key: Buffer, plain: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
    .join(':');
}

function open(key: Buffer, sealed: string): Buffer {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('unknown ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
}

export class LocalKeyWrapper implements KeyWrapper {
  private readonly kek: Buffer;
  constructor(kekBase64: string) {
    this.kek = Buffer.from(kekBase64, 'base64');
    if (this.kek.length !== 32) throw new Error('AI_KEK must be 32 bytes');
  }
  wrap(dek: Buffer): Promise<string> {
    return Promise.resolve(seal(this.kek, dek));
  }
  unwrap(wrapped: string): Promise<Buffer> {
    return Promise.resolve(open(this.kek, wrapped));
  }
}

export interface SealedSecret {
  ciphertext: string;
  wrappedDek: string;
}

export async function encryptSecret(wrapper: KeyWrapper, secret: string): Promise<SealedSecret> {
  const dek = randomBytes(32);
  try {
    return { ciphertext: seal(dek, Buffer.from(secret, 'utf8')), wrappedDek: await wrapper.wrap(dek) };
  } finally {
    dek.fill(0);
  }
}

export async function decryptSecret(wrapper: KeyWrapper, sealed: SealedSecret): Promise<string> {
  const dek = await wrapper.unwrap(sealed.wrappedDek);
  try {
    return open(dek, sealed.ciphertext).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** What the API shows of a key (US-AI-04 AC2). */
export const last4 = (key: string): string => key.slice(-4);
