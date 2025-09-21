# Repository Guidelines

## Project Structure & Module Organization
- `test.js` is the Mineflayer bot entry point; keep new event handlers close by until logic warrants a dedicated `src/` helper.
- `planner_bot/` and `doc/` host experiments and reference notes; treat them as scratch space and document production-ready ideas before graduating them into the main bot.
- Configuration lives in `package.json`; generated artifacts such as `node_modules/` stay uncommitted. Store secrets in `.env.local` and load them via `process.env`.

## Build, Test, and Development Commands
- `npm install` syncs dependencies listed in `package.json`; run after cloning or editing versions.
- `node test.js` boots the bot against the host set in your environment; keep a Minecraft client nearby to observe behavior.
- `npm test` currently exits with the placeholder failure—replace the script with a runner (e.g., Jest) before using it for CI or PR gates.

## Coding Style & Naming Conventions
- Write modern CommonJS JavaScript with 2-space indentation, double-quoted strings, and trailing semicolons to match `test.js`.
- Name event handlers after the Mineflayer event they serve (`onSpawn`, `onChatCommand`), and export helpers with descriptive verbs (`navigateTo`, `parseConfig`).
- Prefer small, documented helpers for protocol-specific sequences; add concise comments when expectations are non-obvious.

## Testing Guidelines
- Place automated checks under `__tests__/` or `test/`, mirroring bot features with scenario names like `chat-command.ping.test.js`.
- Mock Mineflayer interactions to cover chat commands, disconnect handling, and pathfinding edge cases; log regression IDs in test names when fixing bugs.
- When manual testing, note server version, seed, and plugins in your PR so others can replay the scenario.

## Commit & Pull Request Guidelines
- Use imperative commit subjects under 72 characters (`Add ping command response`), grouping related changes per commit.
- PR descriptions should outline the bot behavior change, link issues, share screenshots or bot logs, and call out manual test steps.
- Confirm `npm install` and `node test.js` run cleanly before requesting review; flag remaining TODOs or flaky areas.

## Security & Configuration Tips
- Keep account tokens and server coordinates out of git; inject them with environment variables or `.env.local` ignored by default.
- Throttle outbound chat or command spam when testing on shared servers, and monitor console output for rate-limit warnings or unexpected kicks.
