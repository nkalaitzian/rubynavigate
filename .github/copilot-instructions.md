# RubyNavigate: AI Coding Agent Instructions

## Project Overview
**RubyNavigate** is a VS Code extension that provides fast navigation to Ruby classes, modules, and constants using fully qualified names. It's built to handle large Ruby/Rails projects efficiently.

## Architecture: Four-Layer Design

### 1. **Extension Layer** (`src/extension.ts`)
- **Entry point** for VS Code extension; manages activation and command registration
- **Picker UI**: Creates and updates Quick Pick with smart filtering, grouping (Currently Open → Recently Opened → Workspace Results)
- **History management**: Persists opened files in extension global state (max 30 items)
- **Key APIs**: `window.createQuickPick()`, `workspace.openTextDocument()`, `commands.registerCommand()`

### 2. **Symbol Cache** (`src/symbolCache.ts`) - **Critical for Performance**
- **Purpose**: Eliminates expensive re-parsing by caching all Ruby symbols on disk
- **Background indexing** (batches of 50 files) with progress reporting including ETA
- **File watchers** automatically invalidate cache when `.rb` files change/create/delete
- **Partial results** available during indexing - picker shows symbols as they're parsed
- **Key pattern**: `cache.set(uri.fsPath, symbols)` maps file paths to their symbols

### 3. **Parser Layer** (`src/rubyParser.ts`) - **Regex-Based Static Analysis**
- **Line-by-line parsing** with symbol stack tracking nested classes/modules
- **Symbols captured**:
  - Classes/modules: `class User < ApplicationRecord` → `"User"`
  - Nested: `class Admin::User` → tracks absolute position with `::`
  - Constants: `MAX_USERS = 10` → includes enclosing namespace (`User::MAX_USERS`)
  - Rails scopes: `scope :active, ->` → captured as `User.active` (dot notation, not `::`
- **Namespace resolution**: Stack-based tracking respects `::` qualifiers (absolute paths reset context)
- **Match functions**: `matchesRubySymbol()` (fuzzy), `compareMatches()` (scoring), `isClassOrModule()` (filtering)

### 4. **Locator Layer** (`src/rubyLocator.ts`) - **File Discovery**
- **Rails-aware path conversion**: `User::Admin` → `app/models/user/admin.rb` via `camelToSnake()` helper
- **Search strategy**: Tries common Rails dirs first (app/models → app/controllers → app/services → lib), then workspace-wide fallback
- **Exclude pattern**: Respects config setting `rubynavigate.excludeDirectories` (default: node_modules, .git, vendor, tmp, dist, out)

## Critical Workflows

### Build & Release
```bash
npm run compile          # TypeScript → dist/extension.js (webpack)
npm run watch           # Auto-recompile on file changes (background task)
npm run watch-tests    # Auto-rerun tests on changes
npm run test           # Jest test suite
npm run release        # Publish to VS Code Marketplace
```

### Version Bumping
When updating the project version in `package.json`:
1. Update version number in `package.json`
2. Run `npm install` to regenerate `package-lock.json` with the new version
3. Commit both files together: `git add package.json package-lock.json && git commit -m "Bump version to X.Y.Z"`

### Testing Pattern
Tests call **real implementation functions** (not mocks) to ensure correctness across refactors:
- `parseRubySymbolsFromText()` for parser tests
- `matchesRubySymbol()` and `compareMatches()` for filtering tests
- `isClassOrModule()` for symbol classification

### Indexing Workflow
1. On activation, `SymbolCache.rebuildIndex()` starts in background (non-blocking)
2. User can immediately open picker while indexing runs
3. Progress notification: `"5000/22000 files (23%) - ETA 2m 15s"`
4. File watchers invalidate cache incrementally as user edits

## Key Design Decisions & Patterns

| Pattern | Example | Why |
|---------|---------|-----|
| **Scope notation** | `User.active` (not `User::active`) | Distinguishes Rails scopes from nested classes |
| **Prefix-reset on `::` absolute** | `class ::Admin` ignores outer context | Supports both `User::Admin` and root-level reopening |
| **Lazy picker opening** | Show immediately, load symbols in background | Users expect instant UI response |
| **Group-based filtering** | Empty query shows Classes/Modules only | Reduces picker clutter; users rarely need all scopes/constants |
| **Batch processing** | Process 50 files per tick + `setTimeout(0)` | Prevents UI freeze on large workspaces |
| **File-path-first discovery** | Check Rails dirs before workspace scan | 95%+ hits in common paths; faster on large projects |

## Configuration & Extensibility

### User Settings (in `contributes.configuration`)
- `rubynavigate.maxCurrentlyOpenItems` (default: 10) - Currently open section size
- `rubynavigate.maxRecentlyOpenedItems` (default: 10) - Recently opened section size
- `rubynavigate.excludeDirectories` (default: `["node_modules", ".git", "vendor", "tmp", "dist", "out"]`) - Scan exclusions

### Extension Points
- Commands: `rubynavigate.find`, `rubynavigate.previewActive`, `rubynavigate.openInBackground`
- Keybindings via `keybindings.json` (documented in README)

## Common Extension Tasks & Implementation Notes

### Adding a New Symbol Type (e.g., methods)
1. Add regex pattern in `parseRubySymbolsFromText()` (e.g., `def methodName`)
2. Update `isClassOrModule()` to classify correctly (e.g., return false for scopes)
3. Add test case in `extension.test.ts`
4. Document format in `matchesRubySymbol()` if it changes matching rules

### Improving Performance for Larger Workspaces
- **Batch size** in `SymbolCache.performIndexing()` - increase if UI is responsive enough
- **ETA calculation** in `formatEta()` - already optimized; verify elapsed time tracking
- **File watchers** - currently one watcher for all `*.rb` files; could segment by directory

### Debugging Symbol Parsing Issues
- Console logs: Extension logs file/symbol counts on completion: `console.log("Indexed ${fileCount} files with ${symbolCount} symbols")`
- Test interactively: Call `parseRubySymbolsFromText(rubyFileContent)` directly with sample code
- Check name format in picker: Should show fully qualified (e.g., `Concerns::Admin::User::Auth`)

## Development Environment
- **Node**: 18.x / 20.x (CI tests both)
- **TypeScript**: ES2020 target, strict mode enabled
- **Bundler**: Webpack (config in `webpack.config.js`)
- **Test runner**: Node.js with Jest
- **Linting/Format**: Consider adding ESLint if contributing new modules
