import { uuidv7 } from '@robosim/shared';
import type { IncomingMessage } from 'node:http';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Accepts a well-formed upstream `X-Request-Id` (ingress, client) and otherwise generates one. */
export function genRequestId(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value && SAFE_ID.test(value) ? value : uuidv7();
}
