# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm install` - Install dependencies after cloning or updating dependency versions
- `node test.js` - Launch the main bot (requires environment variables for server connection)
- `node planner_bot/index.js` - Launch the experimental planner bot with GOAP (Goal-Oriented Action Planning)
- `npm test` - Placeholder test command (currently exits with failure - implement with Jest or similar)

Set environment variables for server connection:
- `MC_HOST` - Server host (default: localhost)
- `MC_PORT` - Server port (default: 25565 for test.js, 25566 for planner_bot)
- `MC_USERNAME` - Bot username (default: My_First_Bot for main bot, PlannerBot for planner)
- `MC_VERSION` - Server version (default: auto-detect)
- `PLANNER_DEBUG=1` - Enable debug logging for planner bot

## Architecture Overview

This is a Minecraft bot project built with Mineflayer that consists of two main implementations:

### Main Bot (`test.js`)
- Simple command-driven bot with basic chat responses
- Supports pathfinding using mineflayer-pathfinder
- Commands: `ping`, `forward`, `chop` (finds and cuts nearest tree)
- Written in Japanese comments but straightforward functionality

### Planner Bot (`planner_bot/`)
**Command-only bot** with GOAP (Goal-Oriented Action Planning) system. This bot responds **only to `!` commands** and ignores natural language messages.

**Core Components:**
- **GOAP Planner** (`src/planner/goap.js`) - A* pathfinding algorithm for action planning
- **State Manager** (`src/planner/state_manager.js`) - Manages bot's world state and caching
- **State Builder** (`src/planner/state_builder.js`) - Converts raw world state into GOAP facts based on state schema
- **Skills System** (`src/skills/`) - High-level behaviors (gathering, crafting, etc.)
- **Primitives** (`src/primitives.js`) - Low-level bot actions (moveTo, digBlock, craftItem, etc.)
- **Creative Actions** (`src/creative_actions/`) - Non-deterministic tasks (navigation, exploration, building)
- **Action Configuration** (`config/actions/`) - Split into multiple YAML files defining actions:
  - `gather_actions.yaml` - Resource gathering actions
  - `hand_craft_actions.yaml` - Crafting without workbench
  - `workbench_craft_actions.yaml` - Crafting table recipes
  - `movement_actions.yaml` - Movement and placement actions
- **State Schema** (`config/state_schema.yaml`) - Defines all available state variables (inventory, environment, world)
- **Block Categories** (`config/block_categories.yaml`) - Groups similar blocks (logs, planks, stones) for flexible matching

**Bot Commands:**
- `!goal <goal_name>` - Execute a planned sequence of actions to achieve a goal (GOAP)
- `!skill <skill_name> [json_params]` - Execute a specific skill directly
- `!status` - Display current bot status (position, inventory, nearby resources)
- `!primitive <primitive_name> [json_params]` - Execute a low-level primitive action
- `!creative <action> [json_params]` - Execute creative actions (navigation, exploration, building)

**3-Layer Architecture:**
1. **GOAP Layer** - Deterministic task automation (crafting, nearby resource gathering)
2. **Creative Actions Layer** - Non-deterministic tasks (exploration, navigation, building, interaction)
3. **LLM Integration** (Optional, separate repository) - Strategic decision-making that uses this bot as a tool

**Goal Planning:**
The bot uses GOAP to automatically plan action sequences. For example, requesting `!goal inventory.wooden_pickaxe:1` will:
1. Analyze current world state vs goal requirements
2. Generate optimal action sequence (gather logs → craft planks → craft sticks → craft pickaxe)
3. Execute each step using the appropriate skills
4. **Reactive Replanning** - If preconditions fail during execution (e.g., items dropped, resources lost), the planner automatically generates a new plan from the current state

**Usage as a Tool:**
This bot is designed to be used directly via commands or as a tool by external LLM agents (e.g., LangChain-based systems). The LLM agent would send commands to the bot via Minecraft chat.

## Code Conventions

- **Language**: CommonJS JavaScript with modern syntax
- **Style**: 2-space indentation, double-quoted strings, trailing semicolons
- **Naming**: Event handlers named after Mineflayer events (`onSpawn`, `onChatCommand`), helper functions use descriptive verbs (`navigateTo`, `parseConfig`)
- **Structure**: Keep gameplay logic in `test.js`, use `planner_bot/` for experiments, port stable features to main bot
- **Configuration**: Store in `package.json`, credentials in `.env.local` via `process.env`

## Key Dependencies

- `mineflayer` (v4.33.0) - Core Minecraft bot framework
- `mineflayer-pathfinder` (custom fork) - Pathfinding and movement
- `yaml` (v2.8.1) - Configuration parsing for planner bot

## Testing Strategy

- Mirror bot scenarios in `__tests__/` or `test/` directories
- Mock Mineflayer sockets and chat for unit tests
- Document manual verification with server version, seed, and plugin details
- Test both simple command responses and complex GOAP planning scenarios

## Bot Design Philosophy

This repository contains a **command-only GOAP bot** that:
- Responds only to `!` commands (`!goal`, `!skill`, `!status`, `!primitive`, `!creative`)
- Ignores natural language messages
- Can be used directly by developers for testing
- Can be used as a tool by external LLM agents (e.g., LangChain-based systems)

**For LLM integration**: Implement in a separate repository that sends commands to this bot via Minecraft chat. This separation keeps the bot logic clean and allows for flexible LLM implementations.