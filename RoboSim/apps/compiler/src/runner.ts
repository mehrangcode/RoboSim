// Runs toolchain commands. `local` builds of untrusted sketches go through a Linux namespace sandbox (Technical Design
// §6, ADR-022): no network, private PID namespace and /proc, only the work dir writable, the toolchain read-only, and
// home/mount/runtime dirs hidden behind empty tmpfs. Resource limits via prlimit; wall-clock limit via kill.
import { spawn } from 'node:child_process';

export const SANDBOX_PATHS = {
  /** Writable work dir (the build). */
  work: '/srv',
  /** Toolchain (core + libraries), read-only. */
  toolchain: '/opt',
  /** Prebuilt core/library archives, read-only. */
  prebuilt: '/media',
} as const;

const HIDDEN = ['/home', '/root', '/mnt', '/tmp', '/var', '/run'];

export interface Mounts {
  readonly work: string;
  readonly toolchain: string;
  readonly prebuilt: string;
}

export interface RunResult {
  readonly code: number | null;
  readonly output: string;
  readonly timedOut: boolean;
}

export interface Runner {
  /** Paths as the command sees them. */
  readonly paths: Mounts;
  run(argv: readonly string[], opts: { cwd: string; deadline: number }): Promise<RunResult>;
}

const MAX_OUTPUT = 256 * 1024;
const LIMITS = ['--as=1073741824', '--fsize=67108864', '--cpu=30', '--nofile=256'];

function exec(
  cmd: string,
  args: readonly string[],
  cwd: string | undefined,
  deadline: number,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const budget = deadline - Date.now();
    if (budget <= 0) {
      resolve({ code: null, output: '', timedOut: true });
      return;
    }
    const child = spawn(cmd, args, {
      cwd,
      detached: true, // own process group, so a timeout kills gcc's children too
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    });
    let output = '';
    const collect = (chunk: Buffer): void => {
      if (output.length < MAX_OUTPUT) output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, budget);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output: output.slice(0, MAX_OUTPUT), timedOut });
    });
  });
}

/** Trusted builds (core and library archives, demo firmware): plain processes, real paths. */
export function directRunner(mounts: Mounts): Runner {
  return {
    paths: mounts,
    run: ([cmd, ...args], { cwd, deadline }) => {
      if (!cmd) throw new Error('empty command');
      return exec(cmd, args, cwd, deadline);
    },
  };
}

const quote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** Untrusted builds: every command runs in fresh user/mount/PID/network namespaces. */
export function sandboxRunner(mounts: Mounts): Runner {
  return {
    paths: SANDBOX_PATHS,
    run: (argv, { cwd, deadline }) => {
      const inner = cwd.replace(mounts.work, SANDBOX_PATHS.work);
      const script = [
        `mount --bind ${quote(mounts.work)} ${SANDBOX_PATHS.work}`,
        `mount --bind ${quote(mounts.toolchain)} ${SANDBOX_PATHS.toolchain}`,
        `mount -o remount,bind,ro ${SANDBOX_PATHS.toolchain}`,
        `mount --bind ${quote(mounts.prebuilt)} ${SANDBOX_PATHS.prebuilt}`,
        `mount -o remount,bind,ro ${SANDBOX_PATHS.prebuilt}`,
        ...HIDDEN.map((d) => `mount -t tmpfs -o size=64m none ${d}`),
        `cd ${quote(inner)}`,
        `exec prlimit ${LIMITS.join(' ')} -- ${argv.map(quote).join(' ')}`,
      ].join(' && ');
      return exec(
        'unshare',
        [
          '--user',
          '--map-root-user',
          '--net',
          '--mount',
          '--pid',
          '--fork',
          '--mount-proc',
          'sh',
          '-c',
          script,
        ],
        undefined,
        deadline,
      );
    },
  };
}

/** Checks that the kernel allows unprivileged namespaces (WSL2 and most distros do). */
export async function sandboxAvailable(): Promise<boolean> {
  try {
    const r = await exec(
      'unshare',
      ['--user', '--map-root-user', '--net', '--mount', '--pid', '--fork', '--mount-proc', 'true'],
      undefined,
      Date.now() + 5_000,
    );
    return r.code === 0;
  } catch {
    return false;
  }
}
