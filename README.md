# RubyNavigate

<p align="center">
  <img src="logo.png" alt="RubyNavigate Logo" width="320" />
</p>

Quickly jump to Ruby classes, modules, constants, Rails scopes, and methods by their fully qualified names. Perfect for navigating large Ruby projects with deeply nested class hierarchies.

## Features

- **Fast Navigation**: Search and jump to any Ruby class, module, constant, or Rails scope in your workspace
- **Fully Qualified Names**: Support for nested modules and qualified class names (e.g., `Foo::Bar::Baz`)
- **Constant Lookup**: Search for Ruby constants defined in classes and modules (e.g., `Foo::BAR`)
- **Rails Scope Lookup**: Search for ActiveRecord scopes defined in your models (e.g., `User.active`)
- **Method Lookup**: Search for class/singleton methods and instance methods (e.g., `User.active` and `User#authenticate`)
- **Smart Result Ordering**: Exact matches first, then prefix matches, then substring matches
  - Within each category, closer/shorter matches are prioritized
  - Search for `User::Admin` shows `User::Admin` → `User::AdminB` → `User::Administrator`
- **Live Filtering**: Results update as you type
- **Smart Grouping**: Results are organized into three sections:
  - **Currently open** files (with Ruby symbols)
  - **Recently opened** files you've previously navigated to
  - **Workspace results** for all other matches
- **Recent History Management**: Remove items from recently opened with the X button
- **Configurable Limits**: Control how many items appear in each section
- **Optimized Performance**: Intelligent caching system for instant results, even in large projects
  - Background indexing on startup with progress notification and ETA
  - Real-time progress updates for large projects (shows file count, percentage, and ETA)
  - Partial results available during indexing; a picker hint explains when results are still loading
  - Automatic cache invalidation when files change
  - Picker opens immediately while symbols load
- **Workspace Scanning**: Automatically discovers Ruby files in your project

## Usage

1. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run: **RubyNavigate: Find Class/Module**
3. Type the class or module name you're looking for
4. Navigate results:
   - **Enter**: Jump to the file and close the picker
   - **Right Arrow**: Preview the file (without closing the picker)
   - **Ctrl+Right Arrow**: Open in background (without closing the picker or taking focus)
   - **X button** (on recently opened items): Remove from history
   - Prefix your query with `::` to constrain the search to root-level symbols (e.g., `::Foo::Bar` will ignore `Baz::Foo::Bar`).

### Copy Qualified Name

You can quickly copy the fully qualified name of any Ruby symbol to your clipboard:

1. Place your cursor inside a Ruby class, module, constant, method, or scope
2. Open the command palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
3. Run: **RubyNavigate: Copy Qualified Name to Clipboard**
4. The fully qualified name will be copied with the appropriate format:
   - **Class/Module**: `User::Admin`
   - **Constant**: `User::Admin::MAX_USERS`
   - **Scope/Class Method**: `User.active` (dot notation)
   - **Instance Method**: `User#authenticate` (hash notation)

Copy behavior details:
- Works from active-file parsing even while background indexing is still running
- Handles one-line definitions (for example, `def self.test; true; end`)
- Preserves namespace through common block structures such as `scope ... do ... end` and `included do ... end`

## Keyboard Shortcuts

You can add a custom keyboard shortcut to quickly access RubyNavigate:

1. Open keyboard shortcuts: `Ctrl+K Ctrl+S` (Windows/Linux) or `Cmd+K Cmd+S` (Mac)
2. Search for "RubyNavigate"
3. Click the pencil icon next to "RubyNavigate: Find Class/Module"
4. Press your desired key combination (e.g., `Ctrl+Shift+/`)
5. Press Enter to confirm

Alternatively, you can manually add this to your `keybindings.json`:

```json
{
  "key": "ctrl+shift+/",
  "command": "rubynavigate.find"
},
{
  "key": "ctrl+alt+c",
  "command": "rubynavigate.copyQualifiedName"
}
```

## Configuration

Customize the behavior of RubyNavigate through VS Code settings:

- **`rubynavigate.maxCurrentlyOpenItems`** (default: `10`)  
  Maximum number of currently open items to display in the Quick Pick.

- **`rubynavigate.maxRecentlyOpenedItems`** (default: `10`)  
  Maximum number of recently opened items to display in the Quick Pick.

- **`rubynavigate.excludeDirectories`** (default: `["node_modules", ".git", "vendor", "tmp", "dist", "out"]`)  
  Directories to exclude when searching for Ruby files. Each entry will be matched as `**/{entry}/**`.

Example settings:

```json
{
  "rubynavigate.maxCurrentlyOpenItems": 15,
  "rubynavigate.maxRecentlyOpenedItems": 20,
  "rubynavigate.excludeDirectories": ["node_modules", "vendor", "tmp", "coverage"]
}
```

## Examples

Given a project structure:

```
app/models/
  user.rb          # class User < ApplicationRecord
                   #   STATUS = [:active, :inactive].freeze
                   #   scope :active, -> { where(status: :active) }
  admin/
    panel.rb       # module Admin; class Panel; end
lib/
  utils.rb         # module Utils; class Helper; end
```

You can search for:

- `User` - Finds the User class
- `User::STATUS` - Finds the STATUS constant in the User class
- `User.active` - Finds the active scope in the User class
- `User.` - Finds all scopes defined in User class
- `Admin::Panel` - Finds the Panel class nested in Admin module
- `Utils::Helper` - Finds the Helper class in Utils module
- `Panel` - Partial match also works (case-insensitive)
- `Ad` - Prefix matching to find Admin module classes
