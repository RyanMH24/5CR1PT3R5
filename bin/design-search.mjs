#!/usr/bin/env node
// Design database search used by the design agent. See src/design-search.ts.
const { main } = await import('../src/design-search.ts');
process.exitCode = main(process.argv.slice(2));
