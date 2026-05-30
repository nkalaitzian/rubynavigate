# Plan: 7 Features for RubyNavigate (Sequential Commits)

Each feature is implemented, tested, documented, and version-bumped independently.

---

## Recommended Implementation Order

| # | Feature | Complexity | Version |
|---|---------|-----------|---------|
| 1 | Status Bar Indexing Indicator | Low | 0.0.22 |
| 2 | Cancellable Indexing | Low | 0.0.23 |
| 3 | Fuzzy/CamelCase Matching | Medium | 0.0.24 |
| 4 | Workspace Symbol Provider | Medium | 0.0.25 |
| 5 | Document Symbol Provider | Medium | 0.0.26 |
| 6 | Go to Definition Provider | Medium | 0.0.27 |
| 7 | Most-Used Symbols (Frequency Boost) | Medium | 0.0.28 |

---

## Feature 1: Status Bar Indexing Indicator (0.0.22)

Create a `StatusBarItem` that shows `$(sync~spin) Indexing 500/2000...` during indexing, then `$(ruby) 2000 symbols` when done. Hook into `symbolCache.onCacheUpdate()` and indexing lifecycle.

**Files**: `src/extension.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `copilot-instructions.md`

---

## Feature 2: Cancellable Indexing (0.0.23)

Change `cancellable: false` → `true` in `window.withProgress()`, pass `CancellationToken` to `symbolCache.rebuildIndex()`, check `token.isCancellationRequested` between batches in `performIndexing()`. Partial results remain available.

**Files**: `src/extension.ts`, `src/symbolCache.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `copilot-instructions.md`

---

## Feature 3: Fuzzy/CamelCase Matching (0.0.24)

Add `matchesCamelCase(name, query)` that matches uppercase-initial subsequences (`UsAd` → `User::Admin`). Fall back to it when substring match fails. Update `compareMatches()` to rank: exact > prefix > substring > camelCase.

**Files**: `src/rubyParser.ts`, `src/test/suite/extension.test.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `copilot-instructions.md`

---

## Feature 4: Workspace Symbol Provider (0.0.25)

Register `WorkspaceSymbolProvider`. `provideWorkspaceSymbols(query)` filters the cache with `matchesRubySymbol()`, sorts with `compareMatches()`, maps to `SymbolInformation` with appropriate `SymbolKind`. Add a `getSymbolKind(name)` helper in `rubyParser.ts`.

**Files**: `src/extension.ts`, `src/rubyParser.ts`, `src/test/suite/extension.test.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `copilot-instructions.md`

---

## Feature 5: Document Symbol Provider (0.0.26)

Register `DocumentSymbolProvider`. Parse active document, build nested `DocumentSymbol` tree (classes/modules contain methods/constants/scopes). Reuse `getSymbolKind()` from Feature 4.

**Files**: `src/extension.ts`, `src/rubyParser.ts` (hierarchy info), `src/test/suite/extension.test.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `copilot-instructions.md`

---

## Feature 6: Go to Definition Provider (0.0.27)

Register `DefinitionProvider`. Extract word at cursor (handle `::` and `.` in identifiers), look up in symbol cache via exact match then fuzzy, return `Location[]`.

**Files**: `src/extension.ts`, `src/rubyLocator.ts` (word extraction helper), `src/test/suite/extension.test.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `copilot-instructions.md`

---

## Feature 7: Most-Used Symbols / Frequency Boost (0.0.28)

Track navigation frequency in global state (`Record<string, number>`). Increment on `openRubyLocation()`. Use frequency as tie-breaker in `compareMatches()` within same match tier. Cap at 200 entries.

**Files**: `src/extension.ts`, `src/rubyParser.ts`, `src/test/suite/extension.test.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `copilot-instructions.md`

---

## Verification (every feature)

1. `npm run compile` passes
2. `npm test` passes (existing + new tests)
3. Manual test in Extension Development Host

## Decisions

- Each feature = 1 patch version bump + 1 commit
- Features are independent (except Feature 5 reuses `getSymbolKind()` from Feature 4)
- Order starts with simplest/lowest-risk
