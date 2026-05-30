import { window, commands, ExtensionContext, workspace, Range, Selection, TextEditorRevealType, Uri, QuickPickItem, QuickPickItemKind, ThemeIcon, ProgressLocation, env, StatusBarAlignment, StatusBarItem, CancellationToken } from 'vscode';
import { listRubySymbols, RubySymbol, setSymbolCache } from './rubyLocator';
import { matchesRubySymbol, compareMatches, isClassOrModule, parseRubySymbolsFromText } from './rubyParser';
import { SymbolCache } from './symbolCache';

let extensionContext: ExtensionContext;
let currentPicker: any;
let refreshPicker: ((value: string) => void) | undefined;
let symbolCache: SymbolCache;
let statusBarItem: StatusBarItem;

export function activate(context: ExtensionContext) {
  extensionContext = context;

  // Initialize symbol cache with storage URI for disk persistence
  symbolCache = new SymbolCache(context.globalStorageUri);
  setSymbolCache(symbolCache);
  context.subscriptions.push(symbolCache);

  // Create status bar item for indexing indicator
  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 0);
  statusBarItem.command = 'rubynavigate.find';
  context.subscriptions.push(statusBarItem);

  // Start indexing in background (don't await) - only if workspace is open
  if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
    interface ProgressReporter {
      report: (value: { message?: string; increment?: number }) => void;
    }

    // Show status bar as indexing
    statusBarItem.text = '$(sync~spin) Indexing...';
    statusBarItem.tooltip = 'RubyNavigate: Indexing Ruby symbols...';
    statusBarItem.show();

    // Register cache update callback to update status bar during indexing
    symbolCache.onCacheUpdate(() => {
      if (symbolCache.isIndexingActive()) {
        const processed = symbolCache.getProcessedFiles();
        const total = symbolCache.getTotalFiles();
        statusBarItem.text = `$(sync~spin) Indexing ${processed}/${total}...`;
        statusBarItem.tooltip = `RubyNavigate: Indexing Ruby symbols (${processed}/${total} files)`;
      }
    });

    window.withProgress({
      location: ProgressLocation.Notification,
      title: "RubyNavigate: Indexing symbols",
      cancellable: true
    }, async (progress: ProgressReporter, token: CancellationToken) => {
      await symbolCache.rebuildIndex(progress, token);
      const fileCount = symbolCache.getFileCount();
      const symbolCount = symbolCache.getSymbolCount();
      if (token.isCancellationRequested) {
        console.log(`RubyNavigate: Indexing cancelled. Partial index: ${fileCount} files with ${symbolCount} symbols`);
      } else {
        console.log(`RubyNavigate: Indexed ${fileCount} files with ${symbolCount} symbols`);
      }
      updateStatusBarIdle();
      return;
    }).then(undefined, (err: Error) => {
      console.error('RubyNavigate: Error during indexing:', err);
      window.showErrorMessage(`RubyNavigate: Failed to index symbols: ${err.message}`);
      updateStatusBarIdle();
    });
  } else {
    statusBarItem.hide();
  }

  context.subscriptions.push(commands.registerCommand('rubynavigate.find', async () => {
    await showRubySymbolPicker();
  }));

  // Command to fill the search bar with the highlighted entry's name (triggered by Right arrow)
  context.subscriptions.push(commands.registerCommand('rubynavigate.fillFromActive', async () => {
    if (currentPicker && currentPicker.activeItems && currentPicker.activeItems.length > 0) {
      const picked = currentPicker.activeItems[0] as RubyPickItem;
      if (picked && picked.symbol) {
        currentPicker.value = picked.symbol.name;
      }
    }
  }));

  // Command to open the currently active selection in the background (preserve focus)
  context.subscriptions.push(commands.registerCommand('rubynavigate.openInBackground', async () => {
    if (currentPicker && currentPicker.activeItems && currentPicker.activeItems.length > 0) {
      const picked = currentPicker.activeItems[0] as RubyPickItem;
      if (picked && picked.symbol) {
        const symbol = picked.symbol;
        const doc = await workspace.openTextDocument(symbol.uri);
        await window.showTextDocument(doc, { preview: false, preserveFocus: true });
        if (symbol.range) {
          const editor = window.visibleTextEditors.find(e => e.document.uri.fsPath === symbol.uri.fsPath);
          if (editor) {
            editor.revealRange(symbol.range, TextEditorRevealType.InCenter);
          }
        }
      }
    }
  }));

  // Command to copy fully qualified name of symbol at caret to clipboard
  context.subscriptions.push(commands.registerCommand('rubynavigate.copyQualifiedName', async () => {
    await copyQualifiedNameAtCaret();
  }));

  // Command to rebuild the symbol cache
  context.subscriptions.push(commands.registerCommand('rubynavigate.rebuildCache', async () => {
    await rebuildSymbolCache();
  }));
}

function updateStatusBarIdle() {
  const symbolCount = symbolCache.getSymbolCount();
  statusBarItem.text = `$(ruby) ${symbolCount} symbols`;
  statusBarItem.tooltip = `RubyNavigate: ${symbolCount} Ruby symbols indexed (click to search)`;
  statusBarItem.show();
}

async function rebuildSymbolCache() {
  const answer = await window.showInformationMessage(
    'This will clear the symbol cache and rebuild it from scratch. Continue?',
    'Yes',
    'No'
  );

  if (answer !== 'Yes') {
    return;
  }

  interface ProgressReporter {
    report: (value: { message?: string; increment?: number }) => void;
  }

  statusBarItem.text = '$(sync~spin) Rebuilding...';
  statusBarItem.tooltip = 'RubyNavigate: Rebuilding symbol cache...';

  await window.withProgress({
    location: ProgressLocation.Notification,
    title: "RubyNavigate: Rebuilding symbol cache",
    cancellable: true
  }, async (progress: ProgressReporter, token: CancellationToken) => {
    await symbolCache.clearAndRebuildIndex(progress, token);
    const fileCount = symbolCache.getFileCount();
    const symbolCount = symbolCache.getSymbolCount();
    if (token.isCancellationRequested) {
      window.showInformationMessage(`RubyNavigate: Rebuild cancelled. Partial cache: ${fileCount} files and ${symbolCount} symbols`);
    } else {
      window.showInformationMessage(`RubyNavigate: Rebuilt cache with ${fileCount} files and ${symbolCount} symbols`);
    }
    console.log(`RubyNavigate: Rebuilt cache with ${fileCount} files and ${symbolCount} symbols`);
    updateStatusBarIdle();
    return;
  }).then(undefined, (err: Error) => {
    console.error('RubyNavigate: Error during cache rebuild:', err);
    window.showErrorMessage(`RubyNavigate: Failed to rebuild cache: ${err.message}`);
    updateStatusBarIdle();
  });
}

async function copyQualifiedNameAtCaret() {
  const editor = window.activeTextEditor;
  if (!editor || !editor.document.fileName.endsWith('.rb')) {
    window.showWarningMessage('RubyNavigate: No active Ruby file');
    return;
  }

  const caretPos = editor.selection.active;
  // Parse the active file first to ensure fully-qualified names reflect its namespace
  const text = editor.document.getText();
  const parsed = parseRubySymbolsFromText(text);
  let currentFileSymbols: RubySymbol[] = parsed.map(entry => {
    const start = editor.document.positionAt(entry.index);
    const end = editor.document.positionAt(entry.index + entry.length);
    return { name: entry.name, uri: editor.document.uri, range: new Range(start, end) };
  });

  // If parsing didn't find any symbol (edge-case), fall back to cache for this file
  if (currentFileSymbols.length === 0) {
    const allSymbols = await listRubySymbols();
    currentFileSymbols = allSymbols.filter(s => s.uri.fsPath === editor.document.uri.fsPath);
  }

  // Find the symbol that contains the caret line (line-based matching)
  const caretLine = caretPos.line;
  let matchedSymbol: RubySymbol | undefined;
  for (const symbol of currentFileSymbols) {
    if (!symbol.range) { continue; }
    const startLine = symbol.range.start.line;
    const endLine = symbol.range.end.line;
    if (caretLine >= startLine && caretLine <= endLine) {
      // prefer the most specific (smallest span)
      const span = endLine - startLine;
      if (!matchedSymbol) {
        matchedSymbol = symbol;
      } else {
        const bestSpan = matchedSymbol.range!.end.line - matchedSymbol.range!.start.line;
        if (span < bestSpan) { matchedSymbol = symbol; }
      }
    }
  }

  if (!matchedSymbol) {
    // As a last resort try global cache (other indexing strategies)
    const allSymbols = await listRubySymbols();
    for (const symbol of allSymbols) {
      if (symbol.uri.fsPath === editor.document.uri.fsPath && symbol.range && symbol.range.contains(caretPos)) {
        matchedSymbol = symbol;
        break;
      }
    }

    if (!matchedSymbol) {
      window.showWarningMessage('RubyNavigate: No symbol found at cursor position');
      return;
    }
  }

  // Copy the qualified name to clipboard
  await env.clipboard.writeText(matchedSymbol.name);
  window.showInformationMessage(`RubyNavigate: Copied "${matchedSymbol.name}" to clipboard`);
}

export function deactivate() { }

async function openRubyLocation(match: { uri: Uri; range?: Range }) {
  const document = await workspace.openTextDocument(match.uri);
  const editor = await window.showTextDocument(document, { preview: false });
  if (match.range) {
    editor.revealRange(match.range, TextEditorRevealType.InCenter);
    editor.selection = new Selection(match.range.start, match.range.start);
  }

  // Save to history
  const history = extensionContext.globalState.get<string[]>('openedFiles', []);
  const filePath = match.uri.fsPath;

  // Remove if already exists, then add to front
  const filtered = history.filter(f => f !== filePath);
  const updated = [filePath, ...filtered].slice(0, 30); // Keep last 30
  await extensionContext.globalState.update('openedFiles', updated);
}

type RubyPickItem = QuickPickItem & { symbol?: RubySymbol };

/**
 * Check if a symbol is a class or module (not a scope or constant)
 * - Scopes contain a dot: User.active
 * - Constants contain :: with UPPERCASE suffix: Foo::BAR
 * - Classes/modules: Foo or Foo::Bar (normal capitalization)
 */


function getCurrentlyOpenSymbolFiles(allSymbols: RubySymbol[]): Set<string> {
  const openRubyFiles = new Set<string>();

  // Try to extract URIs from tab inputs (works across TabInput types)
  for (const group of window.tabGroups.all) {
    for (const tab of group.tabs) {
      try {
        const input: any = (tab as any).input;
        let uri: Uri | undefined;
        if (input) {
          uri = input.uri ?? input.resource ?? input.text ?? undefined;
        }
        if (uri && uri.fsPath && uri.fsPath.endsWith('.rb')) {
          openRubyFiles.add(uri.fsPath);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // Fallback: include visible editors
  for (const editor of window.visibleTextEditors) {
    try {
      const p = editor.document.uri.fsPath;
      if (p.endsWith('.rb')) { openRubyFiles.add(p); }
    } catch (e) {
      // ignore
    }
  }

  // Only return files that are both open AND have symbols found by the extension
  const symbolFiles = new Set(allSymbols.map(s => s.uri.fsPath));
  const recentFiles = new Set<string>();
  for (const file of openRubyFiles) {
    if (symbolFiles.has(file)) { recentFiles.add(file); }
  }
  return recentFiles;
}

function getPreviouslyOpenedSymbolFiles(allSymbols: RubySymbol[]): string[] {
  const history = extensionContext.globalState.get<string[]>('openedFiles', []);
  const currentlyOpen = getCurrentlyOpenSymbolFiles(allSymbols);
  const symbolFiles = new Set(allSymbols.map(s => s.uri.fsPath));

  // Filter history to only include files with symbols and exclude currently open
  return history.filter(file => symbolFiles.has(file) && !currentlyOpen.has(file));
}

async function showRubySymbolPicker() {
  const picker = window.createQuickPick<RubyPickItem>();
  currentPicker = picker;
  picker.placeholder = 'Type a Ruby class or module (e.g. Foo::Bar)';

  // We'll perform our own matching and keep sections stable, disable built-in matching
  picker.matchOnDescription = false;
  picker.matchOnDetail = false;
  picker.busy = true;

  // Set context so keybindings are available
  await commands.executeCommand('setContext', 'extension.rubynavigate.pickerActive', true);

  // Show picker immediately
  picker.show();

  // Load symbols in background
  let allSymbols: RubySymbol[] = [];
  let currentlyOpen: Set<string> = new Set();

  const updateItems = (value: string) => {
    let filtered = allSymbols.filter(symbol => matchesRubySymbol(symbol.name, value));

    // When search term is empty, only show classes/modules (not scopes or constants)
    // This makes the picker less cluttered and more focused on navigation
    if (value.trim().length === 0) {
      filtered = filtered.filter(symbol => isClassOrModule(symbol.name) && !symbol.isPrivate);
    } else {
      // When searching, still exclude private methods to keep results clean
      // (users searching for private methods can explicitly search for them)
      filtered = filtered.filter(symbol => !symbol.isPrivate);
    }

    // Sort filtered results by match quality (best matches first)
    filtered.sort((a, b) => compareMatches(a.name, b.name, value));

    const recentlyOpened = getPreviouslyOpenedSymbolFiles(allSymbols); // Refresh from global state

    // Read settings for max items per group (defaults to 10)
    const config = workspace.getConfiguration('rubynavigate');
    const maxCurrently = config.get<number>('maxCurrentlyOpenItems', 10) || 10;
    const maxRecently = config.get<number>('maxRecentlyOpenedItems', 10) || 10;

    // When query is empty, always restrict currently-open and recently-opened sections
    // to classes/modules only (regardless of the global filter already applied).
    // This prevents orphaned method names from appearing in those sections.
    const isEmptyQuery = value.trim().length === 0;

    // Separate into three categories
    const current = filtered
      .filter(symbol => currentlyOpen.has(symbol.uri.fsPath))
      .filter(symbol => !isEmptyQuery || isClassOrModule(symbol.name));
    const previous = filtered
      .filter(symbol => recentlyOpened.includes(symbol.uri.fsPath))
      .filter(symbol => !isEmptyQuery || isClassOrModule(symbol.name));
    const other = filtered.filter(symbol =>
      !currentlyOpen.has(symbol.uri.fsPath) && !recentlyOpened.includes(symbol.uri.fsPath)
    );

    // Build items in priority order and insert visual separators between groups
    const items: Array<RubyPickItem | { label?: string; kind: QuickPickItemKind; }> = [];
    let count = 0;

    // Show indexing hint while cache is still building
    if (symbolCache && symbolCache.isIndexingActive()) {
      items.push({ label: 'Indexing symbols... results will improve as more files load', kind: QuickPickItemKind.Separator });
    }

    const fillButton = {
      iconPath: new ThemeIcon('search'),
      tooltip: 'Use as search filter'
    };
    const removeButton = {
      iconPath: new ThemeIcon('close'),
      tooltip: 'Remove from recently opened'
    };

    // Add currently open (with separator)
    if (current.length > 0) {
      items.push({ label: 'Currently open', kind: QuickPickItemKind.Separator });
      let currentCount = 0;
      for (const symbol of current) {
        if (currentCount >= maxCurrently || count >= 200) { break; }
        items.push({
          label: symbol.name,
          description: workspace.asRelativePath(symbol.uri),
          buttons: [fillButton],
          symbol
        } as RubyPickItem);
        currentCount++;
        count++;
      }
    }

    // Add previously opened (with separator and remove button)
    if (previous.length > 0) {
      items.push({ label: 'Recently opened', kind: QuickPickItemKind.Separator });
      let prevCount = 0;
      for (const symbol of previous) {
        if (prevCount >= maxRecently || count >= 200) { break; }
        items.push({
          label: symbol.name,
          description: workspace.asRelativePath(symbol.uri),
          buttons: [fillButton, removeButton],
          symbol
        } as RubyPickItem);
        prevCount++;
        count++;
      }
    }

    // Add other workspace results (with separator)
    if (other.length > 0) {
      items.push({ label: 'Workspace results', kind: QuickPickItemKind.Separator });
      for (const symbol of other) {
        if (count >= 200) { break; }
        items.push({
          label: symbol.name,
          description: workspace.asRelativePath(symbol.uri),
          buttons: [fillButton],
          symbol
        } as RubyPickItem);
        count++;
      }
    }

    picker.items = items as any;
  };

  // expose refresh so commands can request a refresh after modifying history
  refreshPicker = updateItems;

  // Start loading symbols asynchronously
  listRubySymbols().then(symbols => {
    allSymbols = symbols;
    currentlyOpen = getCurrentlyOpenSymbolFiles(allSymbols);
    updateItems(picker.value);
    picker.busy = false;
  }).catch(err => {
    console.error('Error loading symbols:', err);
    picker.busy = false;
  });

  // Register callback for live updates during indexing
  symbolCache.onCacheUpdate(() => {
    // Reload symbols and update picker
    listRubySymbols().then(symbols => {
      allSymbols = symbols;
      currentlyOpen = getCurrentlyOpenSymbolFiles(allSymbols);
      updateItems(picker.value);
    }).catch(err => {
      console.error('Error reloading symbols:', err);
    });
  });

  const disposables = [
    picker.onDidChangeValue(value => updateItems(value)),
    picker.onDidTriggerItemButton(async (event) => {
      const item = event.item as RubyPickItem;
      const button = event.button;

      if (!item.symbol) { return; }

      if (button.tooltip === 'Use as search filter') {
        // Fill search bar with this symbol's name
        picker.value = item.symbol.name;
      } else if (button.tooltip === 'Remove from recently opened') {
        // Remove button clicked - remove from history
        const history = extensionContext.globalState.get<string[]>('openedFiles', []);
        const updated = history.filter(f => f !== item.symbol!.uri.fsPath);
        await extensionContext.globalState.update('openedFiles', updated);
        // Refresh the picker with current search value
        updateItems(picker.value);
      }
    }),
    picker.onDidAccept(async () => {
      const picked = picker.selectedItems[0];
      picker.hide();
      if (picked && 'symbol' in picked && picked.symbol) {
        await openRubyLocation(picked.symbol);
      }
    }),
    picker.onDidHide(async () => {
      picker.dispose();
      currentPicker = undefined;
      refreshPicker = undefined;
      // Clear the cache update callback
      symbolCache.onCacheUpdate(null);
      await commands.executeCommand('setContext', 'extension.rubynavigate.pickerActive', false);
      disposables.forEach(d => d.dispose());
    })
  ];
}
