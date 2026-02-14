import { window, commands, ExtensionContext, workspace, Range, Selection, TextEditorRevealType, Uri, QuickPickItem, QuickPick, QuickPickItemKind, ThemeIcon, QuickInputButton } from 'vscode';
import { listRubySymbols, RubySymbol } from './rubyLocator';
import { matchesRubySymbol } from './rubyParser';

let extensionContext: ExtensionContext;
let currentPicker: any;
let refreshPicker: ((value: string) => void) | undefined;

export function activate(context: ExtensionContext) {
	extensionContext = context;
	context.subscriptions.push(commands.registerCommand('rubynavigate.find', async () => {
		await showRubySymbolPicker();
	}));
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
			if (p.endsWith('.rb')) {openRubyFiles.add(p);}
		} catch (e) {
			// ignore
		}
	}

	// Only return files that are both open AND have symbols found by the extension
	const symbolFiles = new Set(allSymbols.map(s => s.uri.fsPath));
	const recentFiles = new Set<string>();
	for (const file of openRubyFiles) {
		if (symbolFiles.has(file)) {recentFiles.add(file);}
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

	// Set context so Ctrl+D keybinding is available
	await commands.executeCommand('setContext', 'extension.rubynavigate.pickerActive', true);

	const allSymbols = await listRubySymbols();
	const currentlyOpen = getCurrentlyOpenSymbolFiles(allSymbols);

	const updateItems = (value: string) => {
		const filtered = allSymbols.filter(symbol => matchesRubySymbol(symbol.name, value));
		const recentlyOpened = getPreviouslyOpenedSymbolFiles(allSymbols); // Refresh from global state

		// Read settings for max items per group (defaults to 10)
		const config = workspace.getConfiguration('rubynavigate');
		const maxCurrently = config.get<number>('maxCurrentlyOpenItems', 10) || 10;
		const maxRecently = config.get<number>('maxRecentlyOpenedItems', 10) || 10;

		// Separate into three categories
		const current = filtered.filter(symbol => currentlyOpen.has(symbol.uri.fsPath));
		const previous = filtered.filter(symbol => recentlyOpened.includes(symbol.uri.fsPath));
		const other = filtered.filter(symbol =>
			!currentlyOpen.has(symbol.uri.fsPath) && !recentlyOpened.includes(symbol.uri.fsPath)
		);

		// Build items in priority order and insert visual separators between groups
		const items: Array<RubyPickItem | { label?: string; kind: QuickPickItemKind; }> = [];
		let count = 0;

		// Add currently open (with separator)
		if (current.length > 0) {
			items.push({ label: 'Currently open', kind: QuickPickItemKind.Separator });
			let currentCount = 0;
			for (const symbol of current) {
				if (currentCount >= maxCurrently || count >= 200) { break; }
				items.push({
					label: symbol.name,
					description: workspace.asRelativePath(symbol.uri),
					symbol
				} as RubyPickItem);
				currentCount++;
				count++;
			}
		}

		// Add previously opened (with separator and remove buttons)
		if (previous.length > 0) {
			items.push({ label: 'Recently opened', kind: QuickPickItemKind.Separator });
			let prevCount = 0;
			for (const symbol of previous) {
				if (prevCount >= maxRecently || count >= 200) { break; }
				items.push({
					label: symbol.name,
					description: workspace.asRelativePath(symbol.uri),
					buttons: [{
						iconPath: new ThemeIcon('close'),
						tooltip: 'Remove from recently opened'
					}],
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
					symbol
				} as RubyPickItem);
				count++;
			}
		}

		picker.items = items as any;
	};

	// expose refresh so commands can request a refresh after modifying history
	refreshPicker = updateItems;

	updateItems('');
	picker.busy = false;

	const disposables = [
		picker.onDidChangeValue(value => updateItems(value)),
		picker.onDidTriggerItemButton(async (event) => {
			// Remove button clicked - remove from history
			const item = event.item as RubyPickItem;
			if (item.symbol) {
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
			await commands.executeCommand('setContext', 'extension.rubynavigate.pickerActive', false);
			disposables.forEach(d => d.dispose());
		})
	];

	picker.show();
}
