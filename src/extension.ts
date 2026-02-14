import { window, commands, ExtensionContext, workspace, Range, Selection, TextEditorRevealType, Uri, QuickPickItem } from 'vscode';
import { listRubySymbols, RubySymbol } from './rubyLocator';
import { matchesRubySymbol } from './rubyParser';

export function activate(context: ExtensionContext) {
	context.subscriptions.push(commands.registerCommand('rubynavigate.find', async () => {
		await showRubySymbolPicker();
	}));
}

export function deactivate() {}

async function openRubyLocation(match: { uri: Uri; range?: Range }) {
	const document = await workspace.openTextDocument(match.uri);
	const editor = await window.showTextDocument(document, { preview: false });
	if (match.range) {
		editor.revealRange(match.range, TextEditorRevealType.InCenter);
		editor.selection = new Selection(match.range.start, match.range.start);
	}
}

type RubyPickItem = QuickPickItem & { symbol: RubySymbol };

async function showRubySymbolPicker() {
	const picker = window.createQuickPick<RubyPickItem>();
	picker.placeholder = 'Type a Ruby class or module (e.g. Foo::Bar)';
	picker.matchOnDescription = true;
	picker.busy = true;

	const symbols = await listRubySymbols();
	const updateItems = (value: string) => {
		const filtered = symbols.filter(symbol => matchesRubySymbol(symbol.name, value));
		const limited = filtered.slice(0, 200);
		picker.items = limited.map(symbol => ({
			label: symbol.name,
			description: workspace.asRelativePath(symbol.uri),
			symbol
		}));
	};

	updateItems('');
	picker.busy = false;

	const disposables = [
		picker.onDidChangeValue(value => updateItems(value)),
		picker.onDidAccept(async () => {
			const picked = picker.selectedItems[0];
			picker.hide();
			if (picked) {
				await openRubyLocation(picked.symbol);
			}
		}),
		picker.onDidHide(() => {
			picker.dispose();
			disposables.forEach(d => d.dispose());
		})
	];

	picker.show();
}
