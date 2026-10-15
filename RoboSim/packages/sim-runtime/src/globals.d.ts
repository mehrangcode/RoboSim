// UTF-8 codecs: present in every runtime the engine targets (Web Worker, Node), but outside the
// ES lib this package compiles against (no DOM, no Node types).
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
// Web Crypto: global in Web Workers and Node ≥ 19.
declare const crypto: {
  readonly subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> };
};
