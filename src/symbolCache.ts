import { workspace, Uri, Range, FileSystemWatcher, Disposable, Progress } from 'vscode';
import { parseRubySymbolsFromText } from './rubyParser';
import { RubySymbol } from './rubyLocator';

export class SymbolCache {
	private cache: Map<string, RubySymbol[]> = new Map();
	private isIndexing: boolean = false;
	private indexingPromise: Promise<void> | null = null;
	private watchers: Disposable[] = [];
	private indexingStartMs: number | null = null;
	private totalFiles: number = 0;
	private processedFiles: number = 0;

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
		this.indexingStartMs = Date.now();
		this.totalFiles = 0;
		this.processedFiles = 0;

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
		this.totalFiles = totalFiles;
		this.processedFiles = 0;

		if (progress) {
			if (totalFiles === 0) {
				progress.report({ message: 'No Ruby files found' });
			} else {
				progress.report({ message: `Found ${totalFiles} Ruby files` });
			}
		}

		// Process files in batches to avoid blocking
		const batchSize = 50;
		for (let i = 0; i < files.length; i += batchSize) {
			const batch = files.slice(i, i + batchSize);
			await Promise.all(batch.map(uri => this.parseFile(uri)));
			this.processedFiles = Math.min(i + batchSize, totalFiles);
			
			if (progress) {
				const processed = this.processedFiles;
				const percentage = totalFiles === 0 ? 100 : Math.round((processed / totalFiles) * 100);
				const eta = this.formatEta(processed, totalFiles);
				const etaMessage = eta ? ` - ETA ${eta}` : '';
				progress.report({ 
					message: `${processed}/${totalFiles} files (${percentage}%)${etaMessage}`,
					increment: totalFiles === 0 ? 100 : (batchSize / totalFiles) * 100
				});
			}
			
			// Yield to allow other operations
			await new Promise(resolve => setTimeout(resolve, 0));
		}
	}

	private formatEta(processed: number, total: number): string | null {
		if (!this.indexingStartMs || processed <= 0 || total <= 0) {
			return null;
		}
		const elapsedMs = Date.now() - this.indexingStartMs;
		const rate = processed / elapsedMs;
		if (rate <= 0) {
			return null;
		}
		const remaining = total - processed;
		const remainingMs = Math.max(0, remaining / rate);
		const totalSeconds = Math.round(remainingMs / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		if (minutes > 0) {
			return `${minutes}m ${seconds}s`;
		}
		return `${seconds}s`;
	}

	isIndexingActive(): boolean {
		return this.isIndexing;
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
