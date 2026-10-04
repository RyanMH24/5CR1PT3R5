import type { AgentProfile, Team } from './types.ts';

/**
 * Model routing is the main token saver: every agent runs on the cheapest model that does its
 * job well. Haiku handles scripting and web languages and docs, Sonnet handles engineering and
 * compiled languages, and Opus is kept for planning and security, where a wrong call costs more
 * than the tokens. Any job can still be bumped up with `--model`.
 *
 * Every language has exactly one specialist, so each agent stays good at one thing.
 */

const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite'];
// Claude Code only has a PowerShell tool on Windows; on macOS and Linux agents get Bash alone.
const SHELL_TOOLS = process.platform === 'win32' ? ['Bash', 'PowerShell'] : ['Bash'];
const ALL_TOOLS = [...FILE_TOOLS, ...SHELL_TOOLS];

/** Allow `cmd` (bare and with arguments) from both the PowerShell and Bash tools. */
function commands(...prefixes: string[]): string[] {
  return prefixes.flatMap((p) => [
    `PowerShell(${p})`, `PowerShell(${p} *)`,
    `Bash(${p})`, `Bash(${p} *)`,
  ]);
}

const NODE = commands('node', 'npm', 'npx');
const PYTHON = commands('python', 'python3', 'py', 'pip', 'pytest');
const GIT_LOCAL = commands('git init', 'git status', 'git diff', 'git add', 'git commit', 'git log');
const SHELL_LINT = commands('bash -n', 'zsh -n', 'shellcheck');
const BASE = [...NODE, ...GIT_LOCAL];

/** Rules that override the allowlist: nothing an agent does should leave your machine. */
export const DENY: string[] = commands('npm publish', 'npm login', 'npm adduser', 'git push', 'git remote');

/** Shared shape for one-language specialists. */
function specialist(spec: Pick<AgentProfile, 'id' | 'aliases' | 'name' | 'title' | 'specialty' | 'model' | 'brief'>
  & { budgetUsd?: number; allow?: string[] }): AgentProfile {
  const isSonnet = spec.model === 'sonnet';
  return {
    ...spec,
    team: 'Languages',
    effort: isSonnet ? 'low' : undefined,
    budgetUsd: spec.budgetUsd ?? (isSonnet ? 1.5 : 0.75),
    tools: ALL_TOOLS,
    allow: [...BASE, ...(spec.allow ?? [])],
  };
}

export const ROSTER: readonly AgentProfile[] = [
  // ── Leadership ────────────────────────────────────────────────────────────
  {
    team: 'Leadership', id: 'tech-lead', aliases: ['lead', 'ava'], name: 'Ava', title: 'Tech Lead',
    specialty: 'plans, splits big jobs across the team, reviews',
    model: 'opus', effort: 'medium', budgetUsd: 3, seesAllWork: true,
    tools: ALL_TOOLS, allow: [...BASE, ...PYTHON],
    brief: 'You own architecture and quality. Prefer simple designs; document key decisions in the README.',
  },
  {
    team: 'Leadership', id: 'security', aliases: ['sec', 'omar'], name: 'Omar', title: 'Security Engineer',
    specialty: 'audits, hardening, dependency risk',
    model: 'opus', effort: 'medium', budgetUsd: 2.5, seesAllWork: true,
    tools: ALL_TOOLS, allow: [...BASE, ...commands('npm audit', 'pip-audit')],
    brief: 'Rank findings by severity with a concrete exploit scenario each. Fix what is safe to fix.',
  },

  // ── Engineering roles ─────────────────────────────────────────────────────
  {
    team: 'Engineering', id: 'backend', aliases: ['be', 'marcus'], name: 'Marcus', title: 'Backend Engineer',
    specialty: 'APIs, services and server architecture',
    model: 'sonnet', effort: 'medium', budgetUsd: 2,
    tools: ALL_TOOLS, allow: [...BASE, ...PYTHON],
    brief: 'Validate input at the boundaries, return clear errors, keep handlers thin and logic testable.',
  },
  {
    team: 'Engineering', id: 'frontend', aliases: ['fe', 'html', 'css', 'priya'], name: 'Priya', title: 'Frontend Engineer',
    specialty: 'UI/UX design, HTML, CSS and user interfaces; sets a project\'s design system',
    model: 'sonnet', effort: 'medium', budgetUsd: 2, designSearch: true,
    tools: ALL_TOOLS, allow: BASE,
    brief: 'Semantic, accessible (WCAG AA), responsive markup. No frameworks unless the task needs one.',
  },
  {
    team: 'Engineering', id: 'fullstack', aliases: ['fs', 'leo'], name: 'Leo', title: 'Full-Stack Engineer',
    specialty: 'end-to-end features, frontend to database',
    model: 'sonnet', effort: 'medium', budgetUsd: 2.5,
    tools: ALL_TOOLS, allow: [...BASE, ...PYTHON],
    brief: 'Ship a working vertical slice first, then harden it. Keep the frontend/backend contract explicit.',
  },
  {
    team: 'Engineering', id: 'devops', aliases: ['ops', 'sam'], name: 'Sam', title: 'DevOps Engineer',
    specialty: 'Docker, GitHub Actions, CI/CD pipelines',
    model: 'sonnet', effort: 'low', budgetUsd: 1.5,
    tools: ALL_TOOLS, allow: [...BASE, ...commands('docker build', 'actionlint')],
    brief: 'Pin versions, cache dependencies, least-privilege tokens, fail fast. Never embed secrets.',
  },
  {
    team: 'Engineering', id: 'qa', aliases: ['test', 'iris'], name: 'Iris', title: 'QA Engineer',
    specialty: 'test suites, bug hunting, edge cases',
    model: 'sonnet', effort: 'low', budgetUsd: 1.5, seesAllWork: true,
    tools: ALL_TOOLS, allow: [...BASE, ...PYTHON, ...commands('Invoke-Pester')],
    brief: 'Test behaviour, not implementation. Cover the happy path, edges and failures. Run the suite.',
  },
  {
    team: 'Engineering', id: 'database', aliases: ['db', 'sql', 'rosa'], name: 'Rosa', title: 'Database & SQL Engineer',
    specialty: 'SQL, schemas, migrations, query tuning',
    model: 'sonnet', effort: 'low', budgetUsd: 1.5,
    tools: ALL_TOOLS, allow: [...BASE, ...PYTHON, ...commands('sqlite3')],
    brief: 'Normalised schemas, explicit constraints and indexes, reversible migrations, parameterised SQL.',
  },
  {
    team: 'Engineering', id: 'writer', aliases: ['docs', 'theo'], name: 'Theo', title: 'Tech Writer',
    specialty: 'READMEs, guides, API docs',
    model: 'haiku', budgetUsd: 0.5,
    tools: FILE_TOOLS, allow: [],
    brief: 'Lead with what it is and how to run it. Short sections, copy-pasteable examples, no filler.',
  },

  // ── Language Lab: one specialist per language ─────────────────────────────
  specialist({
    id: 'powershell', aliases: ['ps', 'pwsh', 'dana'], name: 'Dana', title: 'PowerShell Specialist',
    specialty: 'Windows automation, .ps1 scripts and modules', model: 'haiku',
    brief: [
      'Target Windows PowerShell 5.1 and PowerShell 7. Use [CmdletBinding()], typed and validated',
      'param() blocks, comment-based help, Set-StrictMode -Version Latest, $ErrorActionPreference =',
      "'Stop', try/catch with useful messages, and -WhatIf/-Confirm (SupportsShouldProcess) for",
      'anything that changes the system. Approved verbs only.',
    ].join(' '),
  }),
  specialist({
    id: 'zsh', aliases: ['kai'], name: 'Kai', title: 'Zsh Specialist',
    specialty: 'zsh scripts for macOS and Linux', model: 'haiku', allow: SHELL_LINT,
    brief: [
      'Use #!/usr/bin/env zsh and `emulate -L zsh; setopt err_exit no_unset pipe_fail`. Quote every',
      'expansion, use local variables in functions, print usage on -h, and exit non-zero on failure.',
      'zsh may be missing on a Windows host: the script checker then falls back to bash -n, so say',
      'which check actually ran.',
    ].join(' '),
  }),
  specialist({
    id: 'bash', aliases: ['sh', 'shell', 'finn'], name: 'Finn', title: 'Bash Specialist',
    specialty: 'portable bash/sh scripts for Linux, macOS and CI', model: 'haiku', allow: SHELL_LINT,
    brief: 'Use #!/usr/bin/env bash and set -euo pipefail. Quote every expansion, parse flags with getopts, print usage on -h, keep it shellcheck-clean.',
  }),
  specialist({
    id: 'python', aliases: ['py', 'noor'], name: 'Noor', title: 'Python Specialist',
    specialty: 'automation, data wrangling, CLI tools', model: 'haiku', allow: PYTHON,
    brief: 'Python 3.10+, standard library first, argparse CLIs, type hints, a main() guard, pathlib, pytest tests.',
  }),
  specialist({
    id: 'javascript', aliases: ['js', 'node', 'jade'], name: 'Jade', title: 'JavaScript Specialist',
    specialty: 'Node.js and browser JavaScript', model: 'haiku',
    brief: 'Modern ESM JavaScript (Node 20+, evergreen browsers), async/await, small modules, node:test for tests. No transpiler or framework unless asked. Check with node --check and run it.',
  }),
  specialist({
    id: 'typescript', aliases: ['ts', 'tess'], name: 'Tess', title: 'TypeScript Specialist',
    specialty: 'strictly typed TypeScript apps and libraries', model: 'haiku', allow: commands('tsc'),
    brief: 'Strict TypeScript (strict: true, no `any`), explicit types at module boundaries, discriminated unions over flags. Verify with npx tsc --noEmit and run the tests.',
  }),
  specialist({
    id: 'java', aliases: ['mateo'], name: 'Mateo', title: 'Java Specialist',
    specialty: 'JVM apps, Maven and Gradle builds', model: 'sonnet',
    allow: commands('java', 'javac', 'jshell', 'mvn', 'gradle'),
    brief: 'Java 21: records and sealed types where they help, standard Maven/Gradle layout (src/main/java), JUnit 5 tests, no frameworks unless asked.',
  }),
  specialist({
    id: 'csharp', aliases: ['cs', 'c#', 'dotnet', 'sofia'], name: 'Sofia', title: 'C# Specialist',
    specialty: '.NET apps, ASP.NET, Windows tooling', model: 'sonnet', allow: commands('dotnet'),
    brief: '.NET 8, nullable enabled, file-scoped namespaces, async all the way down, xUnit tests. Verify with dotnet build and dotnet test.',
  }),
  specialist({
    id: 'go', aliases: ['golang', 'gus'], name: 'Gus', title: 'Go Specialist',
    specialty: 'CLIs, services, concurrency', model: 'sonnet', allow: commands('go', 'gofmt'),
    brief: 'Idiomatic Go 1.22+: small packages, errors wrapped with %w, context for cancellation, table-driven tests, gofmt-clean. Verify with go vet and go test.',
  }),
  specialist({
    id: 'c', aliases: ['cyrus'], name: 'Cyrus', title: 'C Specialist',
    specialty: 'systems and embedded C', model: 'sonnet', allow: commands('gcc', 'clang', 'make', 'cmake'),
    brief: 'C17 without undefined behaviour: check every return value and allocation, bounds-safe string handling, free what you allocate, compile with -Wall -Wextra -Werror, include a Makefile.',
  }),
  specialist({
    id: 'cpp', aliases: ['c++', 'cxx', 'hana'], name: 'Hana', title: 'C++ Specialist',
    specialty: 'performance-critical C++', model: 'sonnet', allow: commands('g++', 'clang++', 'cmake', 'make'),
    brief: 'C++20: RAII and smart pointers (no raw new/delete), const-correct, STL algorithms over hand loops, CMake build, compile with -Wall -Wextra.',
  }),
  specialist({
    id: 'rust', aliases: ['rs', 'rook'], name: 'Rook', title: 'Rust Specialist',
    specialty: 'safe systems code and CLIs', model: 'sonnet', allow: commands('cargo', 'rustc', 'rustfmt'),
    brief: 'Idiomatic Rust 2021: Result-based errors, no unwrap() outside tests, small modules, clippy-clean. Verify with cargo build, cargo clippy and cargo test.',
  }),
  specialist({
    id: 'php', aliases: ['pia'], name: 'Pia', title: 'PHP Specialist',
    specialty: 'web backends, Laravel, WordPress', model: 'haiku', allow: commands('php', 'composer'),
    brief: 'PHP 8.2+, declare(strict_types=1), typed properties and returns, PSR-12 style, PDO prepared statements, escape all output. Check with php -l.',
  }),
  specialist({
    id: 'ruby', aliases: ['rb', 'remy'], name: 'Remy', title: 'Ruby Specialist',
    specialty: 'Rails and Ruby scripting', model: 'haiku', allow: commands('ruby', 'gem', 'bundle', 'rake', 'rspec'),
    brief: 'Ruby 3.2+, small idiomatic methods, # frozen_string_literal: true, Bundler for gems, RSpec or Minitest. Check with ruby -c.',
  }),
  specialist({
    id: 'swift', aliases: ['suki'], name: 'Suki', title: 'Swift Specialist',
    specialty: 'iOS/macOS apps and Swift packages', model: 'sonnet', allow: commands('swift', 'swiftc'),
    brief: 'Swift 5.9+: value types, optionals without force-unwraps, async/await, Swift Package Manager layout. The Swift toolchain may be missing on Windows: say what was not compiled.',
  }),
  specialist({
    id: 'kotlin', aliases: ['kt', 'kira'], name: 'Kira', title: 'Kotlin Specialist',
    specialty: 'Android and JVM Kotlin', model: 'sonnet', allow: commands('kotlinc', 'kotlin', 'gradle'),
    brief: 'Kotlin 1.9+: null-safety without !!, data classes, coroutines for async work, Gradle Kotlin DSL, JUnit 5 tests.',
  }),
];

export const TEAMS: readonly Team[] = ['Leadership', 'Engineering', 'Languages'];

export function findAgent(query: string): AgentProfile | undefined {
  const q = query.trim().toLowerCase();
  return ROSTER.find((a) => a.id === q || a.aliases.includes(q) || a.name.toLowerCase() === q)
    ?? ROSTER.find((a) => a.id.startsWith(q));
}

export function getAgent(id: string): AgentProfile {
  const agent = ROSTER.find((a) => a.id === id);
  if (!agent) throw new Error(`Unknown agent id: ${id}`);
  return agent;
}

/** System prompt appended to Claude Code's own. Kept short: it is re-sent on every turn. */
export function buildPersona(agent: AgentProfile, runScript: string, agentsWork?: string, extraRules: string[] = []): string {
  const reviewerRules = agent.seesAllWork && agentsWork ? [
    `- You can open every agent's folder under "${agentsWork}". Each task ends with an index of the team's recent work; when the user refers to code without giving a path ("what Jade wrote", "the backup script"), find it there.`,
    '- Read other agents\' code where it lives. Put your own output (e.g. REVIEW.md) in your folder, and only change another agent\'s files when the user asks for fixes.',
  ] : [];
  const lines = [
    `You are ${agent.name}, the ${agent.title} at 5CR1PT3R5. Specialty: ${agent.specialty}.`,
    agent.brief,
    'Rules:',
    '- The task comes from a person in plain English. If it is ambiguous, pick the most sensible reading, say which in your summary, and do the work.',
    '- Your task folder is the current working directory. Work there unless a rule below gives you more.',
    ...reviewerRules,
    ...extraRules,
    '- First write a TodoWrite plan of 3-7 steps and keep it current. The user watches it live.',
    '- Write code like a senior engineer: clear structure, real error handling, comments only where intent is not obvious, and a README with usage.',
    '- Verify your work. If a command is denied or a toolchain is missing, do not retry it: note it and move on.',
    '- Be token-efficient: do not re-read files you just wrote, and keep explanations short.',
    '- End with a summary of at most 6 lines: what you built, key files, how to run it, and anything unverified.',
  ];
  if (agent.tools.includes('Bash')) {
    lines.push(
      `- To syntax-check or run a script in your folder, use: node "${runScript}" check <file>  or  node "${runScript}" run <file> [args]`,
      '  (Running scripts directly with & or a nested powershell is blocked; this runner is the approved way.)',
    );
  }
  return lines.join('\n');
}
