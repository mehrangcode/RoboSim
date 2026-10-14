export class IntelHexError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Intel HEX line ${line}: ${message}`);
    this.name = 'IntelHexError';
  }
}

/**
 * Parses Intel HEX (record types 00, 01, 02, 04) into a flat image of `size` bytes, unprogrammed
 * bytes left as 0xFF like erased flash. Checksums are verified; data past `size` is rejected.
 */
export function parseIntelHex(text: string, size: number): Uint8Array {
  const image = new Uint8Array(size).fill(0xff);
  let base = 0;
  let sawEof = false;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = (lines[n] ?? '').trim();
    const lineNo = n + 1;
    if (line === '') continue;
    if (sawEof) throw new IntelHexError('data after EOF record', lineNo);
    if (!/^:([0-9A-Fa-f]{2})+$/.test(line)) throw new IntelHexError('malformed record', lineNo);
    const bytes = Uint8Array.from(line.slice(1).match(/../g) ?? [], (h) => Number.parseInt(h, 16));
    const count = bytes[0] ?? 0;
    if (bytes.length !== count + 5) throw new IntelHexError('byte count mismatch', lineNo);
    const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0);
    if (sum !== 0) throw new IntelHexError('checksum mismatch', lineNo);
    const offset = ((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0);
    const type = bytes[3];
    const data = bytes.subarray(4, 4 + count);
    switch (type) {
      case 0x00: {
        const addr = base + offset;
        if (addr + count > size)
          throw new IntelHexError(`data at 0x${addr.toString(16)} exceeds ${size} bytes`, lineNo);
        image.set(data, addr);
        break;
      }
      case 0x01:
        sawEof = true;
        break;
      case 0x02:
        base = (((data[0] ?? 0) << 8) | (data[1] ?? 0)) << 4;
        break;
      case 0x04:
        base = (((data[0] ?? 0) << 8) | (data[1] ?? 0)) << 16;
        break;
      default:
        // 03/05 (start address) are irrelevant for AVR flash images.
        if (type !== 0x03 && type !== 0x05)
          throw new IntelHexError(`unsupported record type ${type}`, lineNo);
    }
  }
  if (!sawEof) throw new IntelHexError('missing EOF record', lines.length);
  return image;
}

/** Encodes bytes as Intel HEX with 16-byte data records (addresses < 64 KiB). */
export function toIntelHex(bytes: Uint8Array): string {
  const record = (type: number, offset: number, data: Uint8Array): string => {
    const all = [data.length, (offset >> 8) & 0xff, offset & 0xff, type, ...data];
    const checksum = (0x100 - (all.reduce((a, b) => a + b, 0) & 0xff)) & 0xff;
    return ':' + [...all, checksum].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
  };
  if (bytes.length > 0x10000) throw new RangeError('toIntelHex supports images up to 64 KiB');
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push(record(0x00, i, bytes.subarray(i, i + 16)));
  lines.push(record(0x01, 0, new Uint8Array(0)));
  return lines.join('\n') + '\n';
}
