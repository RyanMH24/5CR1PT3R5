import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * `run-script <check|run> <file> [args...]` — the one approved way for agents to syntax-check or
 * execute the scripts they write. Claude Code will not auto-approve `& .\x.ps1` or a nested
 * `powershell` call, because it cannot see what they do. This runner keeps that boundary: it only
 * runs files inside the current task folder, with a timeout, and with the right interpreter.
 */

const RUN_TIMEOUT_MS = 120_000;
const IS_WINDOWS = process.platform === 'win32';

interface Invocation {
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  note?: string;
}

const PS_CHECK = `
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($env:OFFICE_SCRIPT, [ref]$null, [ref]$errors)
if ($errors) {
  $errors | ForEach-Object { '{0}:{1}: {2}' -f $_.Extent.StartLineNumber, $_.Extent.StartColumnNumber, $_.Message }
  exit 1
}
'Syntax OK (PowerShell parser)'
if (Get-Module -ListAvailable -Name PSScriptAnalyzer) {
  $findings = Invoke-ScriptAnalyzer -Path $env:OFFICE_SCRIPT
  $findings | ForEach-Object { '{0} line {1}: [{2}] {3}' -f $_.Severity, $_.Line, $_.RuleName, $_.Message }
  if ($findings | Where-Object Severity -eq 'Error') { exit 1 }
} else { 'PSScriptAnalyzer not installed; lint skipped' }
`;

export function main(argv: string[]): number {
  const [mode, file, ...rest] = argv;
  if ((mode !== 'check' && mode !== 'run') || !file) {
    console.error('Usage: run-script <check|run> <file> [args...]');
    return 2;
  }
  const cwd = realpathSync(process.cwd());
  const target = resolve(cwd, file);
  if (!existsSync(target)) {
    console.error(`No such file: ${file}`);
    return 2;
  }
  const real = realpathSync(target);
  const rel = relative(cwd, real);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    console.error(`Refusing ${file}: only scripts inside the task folder (${cwd}) can be checked or run.`);
    return 2;
  }

  const invocation = plan(mode, real, rest);
  if (typeof invocation === 'string') {
    console.error(invocation);
    return 3;
  }
  if (invocation.note) console.log(`note: ${invocation.note}`);
  const res = spawnSync(invocation.cmd, invocation.args, {
    cwd,
    stdio: 'inherit',
    timeout: RUN_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, ...invocation.env },
  });
  if (res.error) {
    const timedOut = (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    console.error(timedOut ? `Stopped after ${RUN_TIMEOUT_MS / 1000}s.` : `Could not start ${invocation.cmd}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}

/** Choose the interpreter for a script, or return why it cannot be handled here. */
function plan(mode: 'check' | 'run', file: string, args: string[]): Invocation | string {
  const ext = extname(file).toLowerCase();
  switch (ext) {
    case '.ps1':
    case '.psm1': {
      const ps = which('pwsh') ?? (IS_WINDOWS ? 'powershell.exe' : undefined);
      if (!ps) return 'PowerShell is not installed on this machine.';
      if (mode === 'check') return { cmd: ps, args: ['-NoProfile', '-NonInteractive', '-Command', PS_CHECK], env: { OFFICE_SCRIPT: file } };
      return { cmd: ps, args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args] };
    }
    case '.zsh': {
      const zsh = which('zsh');
      if (zsh) return { cmd: zsh, args: mode === 'check' ? ['-n', file] : [file, ...args] };
      const bash = findBash();
      if (mode === 'check' && bash) {
        return { cmd: bash, args: ['-n', file], note: 'zsh is not installed; checked with bash -n, which misses zsh-only syntax.' };
      }
      return 'zsh is not installed on this machine, so .zsh scripts cannot be run here.';
    }
    case '.sh':
    case '.bash': {
      const bash = findBash();
      if (!bash) return 'bash is not installed on this machine.';
      return { cmd: bash, args: mode === 'check' ? ['-n', file] : [file, ...args] };
    }
    case '.py': {
      const py = findPython();
      if (!py) return 'Python is not installed on this machine.';
      return { cmd: py, args: mode === 'check' ? ['-m', 'py_compile', file] : [file, ...args] };
    }
    case '.js':
    case '.mjs':
    case '.cjs':
      return { cmd: process.execPath, args: mode === 'check' ? ['--check', file] : [file, ...args] };
    default:
      return `Unsupported script type "${ext || '(none)'}". Supported: .ps1 .psm1 .zsh .sh .bash .py .js .mjs .cjs`;
  }
}

export function findPython(): string | undefined {
  return which('python3') ?? which('python') ?? which('py');
}

/** On Windows prefer Git Bash; System32\bash.exe is the WSL launcher and sees a different filesystem. */
function findBash(): string | undefined {
  if (IS_WINDOWS) {
    const gitBash = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
    if (existsSync(gitBash)) return gitBash;
  }
  return which('bash');
}

function which(name: string): string | undefined {
  const exts = IS_WINDOWS ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    // Skip the Microsoft Store Python stubs: they print an install prompt instead of running.
    if (IS_WINDOWS && name.startsWith('py') && dir.toLowerCase().includes('windowsapps')) continue;
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
