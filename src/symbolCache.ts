import { workspace, Uri, Range, FileSystemWatcher, Disposable, Progress } from 'vscode';
import { parseRubySymbolsFromText } from './rubyParser';
import { RubySymbol } from './rubyLocator';

export class SymbolCache {
	private cache: Map<string, RubySymbol[]> = new Map();
	private isIndexing: boolean = false;
	private indexingPromise: Promise<void> | null = null;
	private watchers: Disposable[] = [];

	constructor() {
		this.setupFileWatchers();
	}

	private setupFileWatchers() {
		// Watch for Ruby file changes
		const watcher = workspace.createFileSystemWatcher('**/*.rb');
		
		watcher.onDidCreate(uri => this.invalidateFile(uri));
		watcher.onDidChange(uri => this.invalidateFile(uri));
		watcher.onDidDelete(uri => this.removeFile(uri));

		this.watchers.push(watcher);
	}

	private async invalidateFile(uri: Uri) {
		// Re-parse the file
		try {
			const document = await workspace.openTextDocument(uri);
			const text = document.getText();
			const parsed = parseRubySymbolsFromText(text);
			const symbols: RubySymbol[] = parsed.map(entry => {
				const start = document.positionAt(entry.index);
				const end = document.positionAt(entry.index + entry.length);
				return { name: entry.name, uri, range: new Range(start, end) };
			});
			this.cache.set(uri.fsPath, symbols);
		} catch (e) {
			// File might have been deleted or is inaccessible
			this.cache.delete(uri.fsPath);
		}
	}

	private removeFile(uri: Uri) {
		this.cache.delete(uri.fsPath);
	}

	async ensureIndexed(): Promise<void> {
		if (this.isIndexing && this.indexingPromise) {
			return this.indexingPromise;
		}

		if (this.cache.size > 0) {
			// Already indexed
			return Promise.resolve();
		}

		return this.rebuildIndex();
	}

	async rebuildIndex(progress?: Progress<{ message?: string; increment?: number }>): Promise<void> {
		this.isIndexing = true;
		this.cache.clear();

		this.indexingPromise = this.performIndexing(progress);
		await this.indexingPromise;

		this.isIndexing = false;
		this.indexingPromise = null;
	}

	private async performIndexing(progress?: Progress<{ message?: string; increment?: number }>): Promise<void> {
		const config = workspace.getConfiguration('rubynavigate');
		const excludeDirs = config.get<string[]>('excludeDirectories', ['node_modules', '.git', 'vendor', 'tmp', 'dist', 'out']);
		const excludePattern = excludeDirs.length > 0 ? `**/{${excludeDirs.join(',')}}/**` : '';

		const files = await workspace.findFiles('**/*.rb', excludePattern);
		const totalFiles = files.length;

		if (progress) {
			progress.report({ message: `Found ${totalFiles} Ruby files` });
		}

		// Process files in batches to avoid blocking
		const batchSize = 50;
		for (let i = 0; i < files.length; i += batchSize) {
			const batch = files.slice(i, i + batchSize);
			await Promise.all(batch.map(uri => this.parseFile(uri)));
			
			if (progress) {
				const processed = Math.min(i + batchSize, totalFiles);
				const percentage = Math.round((processed / totalFiles) * 100);
				progress.report({ 
					message: `${processed}/${totalFiles} files (${percentage}%)`,
					increment: (batchSize / totalFiles) * 100
				});
			}
			
			// Yield to allow other operations
			await new Promise(resolve => setTimeout(resolve, 0));
		}
	}

	private async parseFile(uri: Uri): Promise<void> {
		try {
			const document = await workspace.openTextDocument(uri);
			const text = document.getText();
			const parsed = parseRubySymbolsFromText(text);
			const symbols: RubySymbol[] = parsed.map(entry => {
				const start = document.positionAt(entry.index);
				const end = document.positionAt(entry.index + entry.length);
				return { name: entry.name, uri, range: new Range(start, end) };
			});
			this.cache.set(uri.fsPath, symbols);
		} catch (e) {
			// Skip files that can't be parsed
		}
	}

	getAllSymbols(): RubySymbol[] {
		const allSymbols: RubySymbol[] = [];
		for (const symbols of this.cache.values()) {
			allSymbols.push(...symbols);
		}
		return allSymbols;
	}

	getSymbolCount(): number {
		return this.getAllSymbols().length;
	}

	getFileCount(): number {
		return this.cache.size;
	}

	dispose() {
		this.watchers.forEach(w => w.dispose());
		this.cache.clear();
	}
}
