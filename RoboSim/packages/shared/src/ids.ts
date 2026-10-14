const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let lastMs = -1;
let counter = 0;

/**
 * RFC 9562 UUIDv7: 48-bit Unix-ms timestamp prefix keeps primary keys index-friendly and time-ordered.
 * Monotonic within this process (RFC 9562 §6.2 method 1): ids created in the same millisecond carry an
 * incrementing 12-bit counter in `rand_a`, so they sort in creation order — callers such as the outbox
 * relay use the id as the tie-breaker for equal timestamps. If the clock stalls or goes backwards the
 * previous timestamp is reused; counter overflow advances it by 1 ms.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  if (nowMs > lastMs) {
    lastMs = nowMs;
    counter = (((bytes[6] ?? 0) & 0x07) << 8) | (bytes[7] ?? 0); // random start, top bit clear leaves headroom
  } else if (++counter > 0xfff) {
    lastMs++;
    counter = 0;
  }
  let ts = lastMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts & 0xff;
    ts = Math.floor(ts / 256);
  }
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
