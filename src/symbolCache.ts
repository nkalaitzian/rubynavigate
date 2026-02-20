import { workspace, Uri, Range, FileSystemWatcher, Disposable, Progress, window, ProgressLocation } from 'vscode';
import { parseRubySymbolsFromText } from './rubyParser';
import { RubySymbol } from './rubyLocator';
import * as fs from 'fs';
import * as path from 'path';

interface CachedFileEntry {
	symbols: Array<{ name: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>;
	mtime: number;
}

export class SymbolCache {
	private cache: Map<string, RubySymbol[]> = new Map();
	private fileModTimes: Map<string, number> = new Map();
	private isIndexing: boolean = false;
	private indexingPromise: Promise<void> | null = null;
	private watchers: Disposable[] = [];
	private indexingStartMs: number | null = null;
	private totalFiles: number = 0;
	private processedFiles: number = 0;
	private cacheFilePath: string | null = null;
	private pendingDiskWrites: Set<string> = new Set();
	private pendingFileChanges: Set<string> = new Set();
	private debounceTimer: NodeJS.Timeout | null = null;
	private debounceDelayMs: number = 500;
	private diskSaveTimer: NodeJS.Timeout | null = null;

	constructor(storageUri?: Uri) {
		if (storageUri) {
			this.cacheFilePath = path.join(storageUri.fsPath, 'symbol-cache.json');
		}
		this.setupFileWatchers();
	}

	async loadFromDisk(): Promise<void> {
		if (!this.cacheFilePath || !fs.existsSync(this.cacheFilePath)) {
			return;
		}

		try {
			const data = fs.readFileSync(this.cacheFilePath, 'utf-8');
			const cacheData: Record<string, CachedFileEntry> = JSON.parse(data);

			for (const [filePath, entry] of Object.entries(cacheData)) {
				try {
					const stat = fs.statSync(filePath);
					const currentMtime = stat.mtimeMs;

					if (entry.mtime === currentMtime) {
						// File hasn't changed, use cached symbols
						const uri = Uri.file(filePath);
						const symbols = entry.symbols.map(sym => ({
							name: sym.name,
							uri,
							range: new Range(
								sym.range.start.line,
								sym.range.start.character,
								sym.range.end.line,
								sym.range.end.character
							)
						}));
						this.cache.set(filePath, symbols);
						this.fileModTimes.set(filePath, currentMtime);
					}
				} catch (e) {
					// File might have been deleted, skip it
				}
			}
		} catch (e) {
			console.error('RubyNavigate: Failed to load cache from disk:', e);
		}
	}

	private async saveToDisk(): Promise<void> {
		if (!this.cacheFilePath) {
			return;
		}

		try {
			// Ensure directory exists
			const dir = path.dirname(this.cacheFilePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			const cacheData: Record<string, CachedFileEntry> = {};

			for (const [filePath, symbols] of this.cache.entries()) {
				const mtime = this.fileModTimes.get(filePath);
				if (mtime !== undefined) {
					cacheData[filePath] = {
						symbols: symbols
							.filter(sym => sym.range !== undefined)
							.map(sym => ({
								name: sym.name,
								range: {
									start: { line: sym.range!.start.line, character: sym.range!.start.character },
									end: { line: sym.range!.end.line, character: sym.range!.end.character }
								}
							})),
						mtime
					};
				}
			}

			fs.writeFileSync(this.cacheFilePath, JSON.stringify(cacheData), 'utf-8');
		} catch (e) {
			console.error('RubyNavigate: Failed to save cache to disk:', e);
		}
	}

	private debouncedSaveToDisk(filePath: string): Promise<void> {
		this.pendingDiskWrites.add(filePath);

		// Only do actual debounced saves if indexing is complete
		if (!this.isIndexing) {
			return this.performDebouncedSave();
		}

		return Promise.resolve();
	}

	private performDebouncedSave(): Promise<void> {
		return new Promise(resolve => {
			// Clear existing disk save timer
			if (this.diskSaveTimer) {
				clearTimeout(this.diskSaveTimer);
			}

			// Set new debounce timer for disk writes
			this.diskSaveTimer = setTimeout(() => {
				this.saveToDisk()
					.then(() => {
						this.pendingDiskWrites.clear();
						resolve();
					})
					.catch(e => {
						console.error('Failed to save cache on debounced write:', e);
						resolve();
					});
				this.diskSaveTimer = null;
			}, 200); // Shorter debounce for disk writes (200ms vs 500ms for parsing)
		});
	}

	private setupFileWatchers() {
		// Watch for Ruby file changes
		const watcher = workspace.createFileSystemWatcher('**/*.rb');
		
		watcher.onDidCreate(uri => this.debouncedInvalidateFile(uri));
		watcher.onDidChange(uri => this.debouncedInvalidateFile(uri));
		watcher.onDidDelete(uri => this.removeFile(uri));

		this.watchers.push(watcher);
	}

	private debouncedInvalidateFile(uri: Uri) {
		// Add file to pending changes
		this.pendingFileChanges.add(uri.fsPath);

		// Clear existing debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// Set new debounce timer
		this.debounceTimer = setTimeout(() => {
			this.processPendingFileChanges().catch(e => {
				console.error('RubyNavigate: Error processing pending file changes:', e);
			});
			this.debounceTimer = null;
		}, this.debounceDelayMs);
	}

	private async processPendingFileChanges() {
		const filesToProcess = Array.from(this.pendingFileChanges);
		this.pendingFileChanges.clear();

		if (filesToProcess.length === 0) {
			return;
		}

		const totalFiles = filesToProcess.length;

		// Show progress notification for file re-indexing
		await window.withProgress({
			location: ProgressLocation.Notification,
			title: `RubyNavigate: Re-indexing ${totalFiles} file${totalFiles === 1 ? '' : 's'}`,
			cancellable: false
		}, async (progress) => {
			let processed = 0;

			// Process files in batches to report progress
			const batchSize = Math.max(1, Math.floor(totalFiles / 10)); // ~10 progress updates
			for (let i = 0; i < filesToProcess.length; i += batchSize) {
				const batch = filesToProcess.slice(i, i + batchSize);

				await Promise.all(batch.map(filePath => {
					const uri = Uri.file(filePath);
					return this.invalidateFile(uri);
				}));

				processed += batch.length;
				const percentage = Math.round((processed / totalFiles) * 100);

				progress.report({
					message: `${processed}/${totalFiles} files (${percentage}%)`,
					increment: (batch.length / totalFiles) * 100
				});
			}

			// Save updated cache to disk after processing all changes
			await this.debouncedSaveToDisk('batch');
		});
	}

	private async invalidateFile(uri: Uri) {
		// Re-parse the file
		try {
			const stat = fs.statSync(uri.fsPath);
			const document = await workspace.openTextDocument(uri);
			const text = document.getText();
			const parsed = parseRubySymbolsFromText(text);
			const symbols: RubySymbol[] = parsed.map(entry => {
				const start = document.positionAt(entry.index);
				const end = document.positionAt(entry.index + entry.length);
				return { name: entry.name, uri, range: new Range(start, end) };
			});
			this.cache.set(uri.fsPath, symbols);
			this.fileModTimes.set(uri.fsPath, stat.mtimeMs);
		} catch (e) {
			// File might have been deleted or is inaccessible
			this.cache.delete(uri.fsPath);
			this.fileModTimes.delete(uri.fsPath);
		}
	}

	private removeFile(uri: Uri) {
		this.cache.delete(uri.fsPath);
		this.fileModTimes.delete(uri.fsPath);
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
		this.indexingStartMs = Date.now();
		this.totalFiles = 0;
		this.processedFiles = 0;

		// Load existing cache from disk first
		await this.loadFromDisk();

		this.indexingPromise = this.performIndexing(progress);
		await this.indexingPromise;

		// Save updated cache to disk
		await this.saveToDisk();

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
				const cached = this.cache.size;
				const remaining = totalFiles - cached;
				progress.report({ message: `Found ${totalFiles} Ruby files (${cached} cached, ${remaining} to process)` });
			}
		}

		// Process files in batches to avoid blocking
		const batchSize = 50;
		for (let i = 0; i < files.length; i += batchSize) {
			const batch = files.slice(i, i + batchSize);
			await Promise.all(batch.map(uri => this.parseFileIfNeeded(uri)));
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

	private async parseFileIfNeeded(uri: Uri): Promise<void> {
		try {
			const stat = fs.statSync(uri.fsPath);
			const currentMtime = stat.mtimeMs;
			const cachedMtime = this.fileModTimes.get(uri.fsPath);

			// If file is in cache and hasn't changed, skip it
			if (cachedMtime !== undefined && cachedMtime === currentMtime && this.cache.has(uri.fsPath)) {
				return;
			}

			// File is new or has changed, parse it
			const document = await workspace.openTextDocument(uri);
			const text = document.getText();
			const parsed = parseRubySymbolsFromText(text);
			const symbols: RubySymbol[] = parsed.map(entry => {
				const start = document.positionAt(entry.index);
				const end = document.positionAt(entry.index + entry.length);
				return { name: entry.name, uri, range: new Range(start, end) };
			});
			this.cache.set(uri.fsPath, symbols);
			this.fileModTimes.set(uri.fsPath, currentMtime);
		} catch (e) {
			// Skip files that can't be parsed
		}
	}

	private async parseFile(uri: Uri): Promise<void> {
		try {
			const stat = fs.statSync(uri.fsPath);
			const document = await workspace.openTextDocument(uri);
			const text = document.getText();
			const parsed = parseRubySymbolsFromText(text);
			const symbols: RubySymbol[] = parsed.map(entry => {
				const start = document.positionAt(entry.index);
				const end = document.positionAt(entry.index + entry.length);
				return { name: entry.name, uri, range: new Range(start, end) };
			});
			this.cache.set(uri.fsPath, symbols);
			this.fileModTimes.set(uri.fsPath, stat.mtimeMs);
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
		// Clean up debounce timers
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.diskSaveTimer) {
			clearTimeout(this.diskSaveTimer);
			this.diskSaveTimer = null;
		}

		this.watchers.forEach(w => w.dispose());
		// Save cache before disposing
		this.saveToDisk().catch(e => console.error('Failed to save cache on dispose:', e));
		this.cache.clear();
		this.fileModTimes.clear();
		this.pendingFileChanges.clear();
		this.pendingDiskWrites.clear();
	}
}
