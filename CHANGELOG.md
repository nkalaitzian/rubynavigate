# Change Log

All notable changes to the "rubynavigate" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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