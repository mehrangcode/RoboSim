import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Firmware storage port (Technical Design §6: "put artifact" to object storage), content-addressed by sha256. The
 * filesystem adapter serves development; an S3/MinIO adapter with signed URLs arrives with the deployment track.
 */
export interface ArtifactStore {
  has(sha256: string): Promise<boolean>;
  get(sha256: string): Promise<string | undefined>;
  put(sha256: string, hex: string): Promise<void>;
}

export class FsArtifactStore implements ArtifactStore {
  constructor(private readonly dir: string) {}

  has(sha256: string): Promise<boolean> {
    return Promise.resolve(SHA256.test(sha256) && existsSync(this.path(sha256)));
  }

  async get(sha256: string): Promise<string | undefined> {
    return (await this.has(sha256)) ? readFile(this.path(sha256), 'utf8') : undefined;
  }

  /** Idempotent; written to a temp name and renamed so readers never see a partial file. */
  async put(sha256: string, hex: string): Promise<void> {
    if (!SHA256.test(sha256)) throw new Error(`not a sha256: ${sha256}`);
    if (await this.has(sha256)) return;
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.path(sha256)}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, hex, 'utf8');
    await rename(tmp, this.path(sha256));
  }

  private path(sha256: string): string {
    return join(this.dir, `${sha256}.hex`);
  }
}
