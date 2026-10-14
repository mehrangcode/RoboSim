// RoboSim is developed inside WSL2 (Engineering Guide §2). Installing or running from native Windows on the
// same checkout swaps platform-specific binaries (esbuild, swc, rollup, lightningcss) and breaks the WSL setup.
if (process.platform === 'win32') {
  console.error(
    [
      '',
      '  RoboSim must be run from WSL, not from Windows PowerShell/cmd.',
      '  Open a WSL terminal (or VS Code with the WSL extension) and run:',
      '',
      '    cd /mnt/d/workSpace/MyProjects/Mehrtronic/RoboSim && pnpm dev',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
