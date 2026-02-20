# Change Log
## [Unreleased]

## [0.0.16] - 2026-02-20

### Added
- **Private Method Support**: Detection and filtering of Ruby private methods
  - Private methods are identified during parsing via the `private` keyword
  - By default, private methods are excluded from picker results to keep navigation focused
  - When search is empty, only classes/modules are shown (no private methods)
  - When actively searching, private methods are hidden from results
  - Users can still search explicitly for private methods if they contain relevant keywords elsewhere
  - Improves noise reduction in picker, making it easier to navigate public APIs

## [0.0.15] - 2026-02-20

### Added
- **Disk Cache Persistence**: Symbol cache is now persisted to disk, enabling near-instant loading on subsequent VS Code restarts
  - Only files that have changed since last session are re-parsed
  - File modification times are tracked to detect changes
  - Cache automatically saved to disk during indexing and on extension shutdown
- **Smart File Watcher Debouncing**: File changes are batched and debounced (500ms) to prevent redundant parsing
  - Multiple file edits within the debounce window are processed together in one batch
  - Disk writes are also debounced (200ms) to minimize I/O during active editing
  - Dramatically improves responsiveness when rapidly saving multiple files
- **Automatic Extension Activation**: Extension now activates automatically when VS Code starts
  - Symbol indexing begins immediately without waiting for user to open the picker
  - Background indexing happens in parallel with user editing
- **Re-indexing Progress Notification**: When files are detected as changed, a progress notification shows the re-indexing status
  - Displays file count being re-indexed with percentage progress
  - Updates progress as files are processed
- **Live Picker Updates**: Picker automatically refreshes as symbols are indexed
  - No need to close and reopen the picker to see newly indexed symbols
  - Results appear and improve in real-time as indexing progresses
  - Updates occur every 100 files (2 batches) for optimal performance
- **Rebuild Symbol Cache Command**: New command to force a complete cache rebuild
  - Accessible via Command Palette: `RubyNavigate: Rebuild Symbol Cache`
  - Clears both in-memory and disk cache, then re-indexes all files from scratch
  - Useful when cache becomes stale or corrupted
- **Cache Size Limit**: Configurable maximum size for the disk cache file
  - New setting `rubynavigate.maxCacheSizeMB` (default: 100 MB)
  - Automatically prunes oldest cache entries when limit is exceeded
  - Prevents unlimited cache growth in large workspaces
  - Logs pruning activity to console for transparency
- **Priority Directory Indexing**: Configure which directories are indexed first for faster perceived performance
  - New setting `rubynavigate.priorityDirectories` controls indexing order
  - Default priority: `app/models`, `app/controllers`, `app/services`, `app/jobs`, `app/helpers`, `app`, `lib`
  - Files in priority directories are processed first, making symbols available sooner
  - Fully customizable - adjust order or add your own directories

### Changed
- `RubyNavigate: Copy Qualified Name to Clipboard` command is now enabled only when the text editor has focus

## [0.0.14] - 2026-02-17

### Added
- Method symbol parsing for:
  - Instance methods (e.g., `User#admin?`)
  - Class/singleton methods (e.g., `User.admins` from `def self.admins`)
  - Receiver singleton methods (e.g., `User.admins` from `def User.admins`)
- `RubyNavigate: Copy Qualified Name to Clipboard` command to copy fully qualified names at cursor position

### Changed
- Symbol ranges now expand to cover full class/module/method blocks, improving line-based symbol detection
- Parser now tracks one-line definitions and common `do ... end` block patterns more accurately

### Fixed
- Qualified-name copy now prefers active-file parsing so it works before cache/index completion
- Namespace preservation through `scope ... do ... end` blocks
- Namespace preservation through `included do ... end` blocks (ActiveSupport::Concern patterns)

## [0.0.13] - 2026-02-17

### Changed
- Refactored test suite to eliminate logic duplication
- Tests now call actual code functions instead of reimplementing logic
  - `isClassOrModule()` now moved to rubyParser.ts and exported for testing
  - Symbol filtering tests use real `isClassOrModule()`, `matchesRubySymbol()`, and `compareMatches()` functions
  - Ensures tests fail if implementation changes, improving test reliability

## [0.0.12] - 2026-02-15

### Added
- Indexing ETA in progress notifications (time remaining estimate)
- Partial results during indexing (symbols appear as files are parsed)
- Picker hint while indexing to explain incomplete results

## [0.0.11] - 2026-02-15

### Added
- Smart result sorting: exact matches first, followed by prefix matches, then substring matches
- Shorter/closer matches prioritized within each match category
- Comprehensive test suite for result ordering behavior
- GitHub Actions workflows for automated testing before builds and releases
  - Tests run on Node.js 18.x and 20.x
  - Test dependency in build and publish workflows ensures quality gates

## [0.0.10] - 2026-02-15

### Added
- Progress notification with real-time updates during symbol indexing
- Visual progress bar showing file processing status (e.g., "5000/22000 files (23%)")
- Improved user feedback for large projects with thousands of Ruby files

## [0.0.9] - 2026-02-15

### Added
- Symbol cache system for improved performance in large projects
- Background indexing on extension activation
- File system watchers for automatic cache invalidation on file changes
- Instant picker opening - results appear as symbols are loaded

### Changed
- Picker now opens immediately and updates as symbols load in the background
- Symbols are cached and only re-parsed when files change
- Significantly improved performance for projects with hundreds or thousands of Ruby files

## [0.0.8] - 2026-02-15

### Added
- Rails scope lookup support - search for scopes defined in classes (e.g., `User.active`)
- Support for scopes in nested classes (e.g., `Admin::User.active_users`)
- Namespace search with `.` separator (e.g., `User.` finds all scopes in User class)
- Tests for scope parsing in various contexts

## [0.0.7] - 2026-02-15

### Added
- Constant lookup support - search for Ruby constants defined in classes and modules (e.g., `Foo::BAR`)
- Support for top-level constants
- Tests for constant parsing in various contexts

## [0.0.6] - 2026-02-14

### Changed
- Improved extension discoverability in VS Code Marketplace with better categorization and search keywords

## [0.0.5] - 2026-02-14

### Added
- Root-aware lookup that treats queries starting with `::` as absolute paths, so `::Foo::Bar` only matches the declaration at the workspace root and ignores nested namespaces (e.g., `Baz::Foo::Bar`).
- Regression tests that exercise the root lookup matcher to keep the new behavior covered.

## [0.0.4] - 2026-02-14

### Added
- Keyboard shortcuts for enhanced navigation within the Quick Pick:
  - **Right Arrow**: Preview the selected file without dismissing the picker
  - **Ctrl+Right Arrow**: Open the selected file in the background (without taking focus) while keeping the picker open
- Preview mode now properly highlights and scrolls to the exact symbol location
- Focus preservation when previewing or opening files in the background
- Configuration setting `rubynavigate.excludeDirectories` to customize which directories are excluded when searching for Ruby files (default: `["node_modules", ".git", "vendor", "tmp", "dist", "out"]`)

### Changed
- Improved Quick Pick to remain open when using keyboard shortcuts for preview/background operations
- Enhanced symbol location highlighting in preview mode

## [0.0.3] - 2026-02-14

### Added
- Visual separators to group results into "Currently open", "Recently opened", and "Workspace results" sections
- Configuration settings to control maximum items per section:
  - `rubynavigate.maxCurrentlyOpenItems` (default: 10)
  - `rubynavigate.maxRecentlyOpenedItems` (default: 10)
- Remove button (X) on recently opened items to clear them from history
- Recently opened files are now tracked and prioritized in the Quick Pick
- Currently open files with Ruby symbols are shown first in results

### Changed
- Quick Pick now maintains grouped sections while filtering/searching
- Results are ordered by relevance: currently open → recently opened → workspace results

## [0.0.2] - 2026-02-14

### Added
- Extension icon/logo featuring Ruby gem with magnifying glass

## [0.0.1] - 2026-02-14

### Added
- Initial release of RubyNavigate extension
- Quick Pick interface for navigating Ruby classes and modules
- Support for nested module/class declarations (e.g., `module Foo; class Bar; end; end`)
- Support for qualified class names (e.g., `class Foo::Bar`)
- Live filtering of search results as you type
- Case-insensitive substring matching for symbol search
- Automatic detection of Ruby files in workspace
- Unit tests for symbol parsing and matching logic