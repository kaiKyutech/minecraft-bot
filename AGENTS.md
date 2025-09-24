# Repository Guidelines

## Project Structure & Module Organization
Keep gameplay logic in `test.js`; add Mineflayer event handlers nearby until they deserve a dedicated helper. Use `planner_bot/` and `doc/` as scratchpads for experiments or reference notes, and port stable ideas into the main bot. Store configuration in `package.json`, keep generated assets like `node_modules/` unversioned, and load credentials or server settings from `.env.local` via `process.env`.

## Build, Test, and Development Commands
Run `npm install` after cloning or tweaking dependency versions to sync the lockfile. Launch the bot locally with `node test.js`, pointing environment variables at your target server; have a Minecraft client connected to observe behavior. `npm test` is currently a placeholder that exits with failure—replace it with a real runner (Jest or similar) before wiring up CI.

## Coding Style & Naming Conventions
Write modern CommonJS JavaScript with 2-space indentation, double-quoted strings, and trailing semicolons to stay consistent with `test.js`. Name event handlers after the Mineflayer event they fulfill, such as `onSpawn` or `onChatCommand`, and export helpers with descriptive verbs like `navigateTo` or `parseConfig`. Favor small, well-commented helpers for protocol-heavy sequences.

## Testing Guidelines
Mirror bot scenarios under `__tests__/` or `test/`, e.g. `test/chat-command.ping.test.js`. Mock Mineflayer sockets and chat to cover disconnect handling, command parsing, and pathfinding edge cases. Document manual verification by noting server version, seed, and plugins so others can reproduce your world state.

## Commit & Pull Request Guidelines
Write imperative commit subjects under 72 characters (for example, `Add ping command response`) and keep each commit focused. PRs should describe the behavior change, link any issues, and include logs or screenshots from recent bot runs. Before requesting review, confirm `npm install` and `node test.js` succeed, and call out TODOs or risky sections.

## Security & Configuration Tips
Keep account tokens, server coordinates, and other secrets out of git; store them in `.env.local` and avoid echoing them into logs. Throttle chat or command spam during testing to prevent kicks, and watch console output for rate-limit warnings or suspicious disconnects.
