#!/usr/bin/env node
// Entry point for the `office` command (npm creates the PowerShell, cmd and sh shims from this).
// Imported dynamically so the source runs as TypeScript via Node's built-in type stripping.
const { main } = await import('../src/cli.ts');
process.exitCode = await main(process.argv.slice(2));
