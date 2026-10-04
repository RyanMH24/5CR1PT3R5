#!/usr/bin/env node
// Script checker/runner used by the scripter agents. See src/run-script.ts.
const { main } = await import('../src/run-script.ts');
process.exitCode = main(process.argv.slice(2));
