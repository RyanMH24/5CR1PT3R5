# Contributing

Thanks for taking a look. 5CR1PT3R5 is a personal project, shared so people can read the code and try the demo. **It doesn't accept pull requests or feature requests.**

You're welcome to **fork it** and make it your own under the [MIT license](../LICENSE). The rest of this page is for you if you do.

- Found a security problem? See [SECURITY.md](SECURITY.md). Please report it privately.
- Want to see how it works? Start with [ARCHITECTURE.md](ARCHITECTURE.md).

## Set up

You need Node.js 22.18+ (it runs the TypeScript directly) and, to run real agents, [Claude Code](https://claude.com/claude-code) logged in.

```sh
npm install
npm run check        # type-check + the whole test suite; must pass before any commit
npm run demo         # build the simulated demo and preview it on 127.0.0.1
office ui            # the real office (after scripts/install.ps1 or install.zsh)
```

To test the page against an empty office without starting any agents:

```sh
# PowerShell
$env:OFFICE_HOME = "$env:TEMP\office-test"; $env:OFFICE_START_WORKERS = "0"; node bin/office.mjs ui --port 4790
```

## Conventions

These keep the codebase small and readable. Follow them in your fork if you'd like it to stay that way.

- **No runtime dependencies.** Node's standard library only. Dev dependencies are TypeScript and `@types/node`.
- **No build step.** Server code is `.ts` run by Node's type stripping, so stick to erasable syntax (no `enum`, no `namespace`, no parameter properties). The page is plain ES modules with `// @ts-check` and JSDoc types.
- **Keep logic pure where you can.** Decisions such as placement, plan parsing, event folding and the demo's clock are pure functions with tests. I/O sits at the edges.
- **Tests use `node:test`,** next to the others in `test/`. Pure logic gets direct tests, and file and process behaviour is tested against real temp folders.
- **Comments say why,** not what. Match the density of the file you're in.
- **User-facing text is plain English,** and errors say what to do next. Anything a person typed is inserted into the page as text, never as HTML.
- **Security boundaries don't move quietly.** Changes to `isTrustedWrite`, `resolveStatic`, the agent allowlists, `run-script` or attachments need a test that shows the boundary still holds.

## Making the office your own

- **Floor plan:** [`web/js/map.js`](../web/js/map.js) holds the rooms, furniture, seats and desks as pure data. A test checks that every seat can still be reached.
- **Characters:** replace `drawCharacter` in [`web/js/sprites.js`](../web/js/sprites.js).
- **Furniture:** one function per type in the `DRAW` table in [`web/js/renderer.js`](../web/js/renderer.js).
- **The team:** agents, models, budgets, tools and allowlists are all in [`src/roster.ts`](../src/roster.ts). The demo picks up changes automatically, because its roster is generated from this file.
