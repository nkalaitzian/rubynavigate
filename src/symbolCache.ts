import { workspace, Uri, Range, FileSystemWatcher, Disposable, Progress, window, ProgressLocation } from 'vscode';
import { parseRubySymbolsFromText } from './rubyParser';
import { RubySymbol } from './rubyLocator';
import * as fs from 'fs';
import * as path from 'path';

interface CachedFileEntry {
	symbols: Array<{ name: string; range: { start: { line: number; character: number }; end: { line: number; character: number } }; isPrivate?: boolean }>;
	mtime: number;
}

export class SymbolCache {
	private static readonly defaultFileIndexTimeoutMs = 5000;

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
	private onCacheUpdateCallback: (() => void) | null = null;

	constructor(storageUri?: Uri) {
		if (storageUri) {
			this.cacheFilePath = path.join(storageUri.fsPath, 'symbol-cache.json');
		}
		this.setupFileWatchers();
	}

	/**
	 * Register a callback to be notified when the cache is updated during indexing.
	 * The callback will be invoked periodically as new symbols are added.
	 */
	onCacheUpdate(callback: (() => void) | null): void {
		this.onCacheUpdateCallback = callback;
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
								isPrivate: sym.isPrivate,
								range: {
									start: { line: sym.range!.start.line, character: sym.range!.start.character },
									end: { line: sym.range!.end.line, character: sym.range!.end.character }
								}
							})),
						mtime
					};
				}
			}

			// Check cache size and prune if necessary
			const prunedData = this.pruneIfNeeded(cacheData);

			fs.writeFileSync(this.cacheFilePath, JSON.stringify(prunedData), 'utf-8');
		} catch (e) {
			console.error('RubyNavigate: Failed to save cache to disk:', e);
		}
	}

	private pruneIfNeeded(cacheData: Record<string, CachedFileEntry>): Record<string, CachedFileEntry> {
		const config = workspace.getConfiguration('rubynavigate');
		const maxSizeMB = config.get<number>('maxCacheSizeMB', 100);
		const maxSizeBytes = maxSizeMB * 1024 * 1024;

		// Calculate current size
		const jsonString = JSON.stringify(cacheData);
		const currentSize = Buffer.byteLength(jsonString, 'utf-8');

		if (currentSize <= maxSizeBytes) {
			return cacheData;
		}

		// Cache is too large, prune oldest entries
		console.warn(`RubyNavigate: Cache size (${(currentSize / 1024 / 1024).toFixed(2)} MB) exceeds limit (${maxSizeMB} MB). Pruning oldest entries...`);

		// Sort entries by modification time (oldest first)
		const sortedEntries = Object.entries(cacheData).sort((a, b) => a[1].mtime - b[1].mtime);

		// Remove oldest entries until we're under the limit
		let prunedData: Record<string, CachedFileEntry> = {};
		let prunedSize = 0;

		// Add entries from newest to oldest until we hit the limit (with 10% buffer)
		const targetSize = maxSizeBytes * 0.9;
		for (let i = sortedEntries.length - 1; i >= 0; i--) {
			const [filePath, entry] = sortedEntries[i];
			const testData = { ...prunedData, [filePath]: entry };
			const testSize = Buffer.byteLength(JSON.stringify(testData), 'utf-8');

			if (testSize <= targetSize) {
				prunedData[filePath] = entry;
				prunedSize = testSize;
			} else {
				break;
			}
		}

		const removedCount = sortedEntries.length - Object.keys(prunedData).length;
		console.log(`RubyNavigate: Pruned ${removedCount} oldest files from cache. New size: ${(prunedSize / 1024 / 1024).toFixed(2)} MB`);

		return prunedData;
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
			return { name: entry.name, uri, range: new Range(start, end), isPrivate: entry.isPrivate };
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

	async clearAndRebuildIndex(progress?: Progress<{ message?: string; increment?: number }>): Promise<void> {
		this.isIndexing = true;
		this.indexingStartMs = Date.now();
		this.totalFiles = 0;
		this.processedFiles = 0;

		// Clear in-memory cache
		this.cache.clear();
		this.fileModTimes.clear();

		// Delete disk cache file
		if (this.cacheFilePath && fs.existsSync(this.cacheFilePath)) {
			try {
				fs.unlinkSync(this.cacheFilePath);
			} catch (e) {
				console.error('RubyNavigate: Failed to delete cache file:', e);
			}
		}

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

		// Prioritize files based on directory configuration
		const prioritizedFiles = this.prioritizeFiles(files);

		// Process files in batches to avoid blocking
		const batchSize = 50;
		for (let i = 0; i < prioritizedFiles.length; i += batchSize) {
			const batch = prioritizedFiles.slice(i, i + batchSize);
			await Promise.all(batch.map(uri => this.parseFileIfNeeded(uri)));
			this.processedFiles = Math.min(i + batchSize, totalFiles);

			// Notify listeners about cache update (every 2 batches for better performance)
			if (this.onCacheUpdateCallback && i % (batchSize * 2) === 0) {
				this.onCacheUpdateCallback();
			}
			
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

		// Final notification when indexing completes
		if (this.onCacheUpdateCallback) {
			this.onCacheUpdateCallback();
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

	private prioritizeFiles(files: Uri[]): Uri[] {
		const config = workspace.getConfiguration('rubynavigate');
		const priorityDirs = config.get<string[]>('priorityDirectories', ['app/models', 'app/controllers', 'app/services', 'app/jobs', 'app/helpers', 'app', 'lib']);

		if (priorityDirs.length === 0) {
			return files;
		}

		// Normalize priority directories for cross-platform matching
		const normalizedPriorityDirs = priorityDirs.map(dir => dir.replace(/[\\/]/g, path.sep));

		// Separate files into priority and non-priority buckets
		const priorityFiles: Uri[] = [];
		const regularFiles: Uri[] = [];

		for (const file of files) {
			const normalizedPath = file.fsPath.replace(/[\\/]/g, path.sep);
			let isPriority = false;

			// Check if file matches any priority directory
			for (const priorityDir of normalizedPriorityDirs) {
				if (normalizedPath.includes(path.sep + priorityDir + path.sep) || 
				    normalizedPath.includes(path.sep + priorityDir.replace(/\//g, path.sep) + path.sep)) {
					isPriority = true;
					break;
				}
			}

			if (isPriority) {
				priorityFiles.push(file);
			} else {
				regularFiles.push(file);
			}
		}

		// Sort priority files by the order of priority directories
		priorityFiles.sort((a, b) => {
			const aPath = a.fsPath.replace(/[\\/]/g, path.sep);
			const bPath = b.fsPath.replace(/[\\/]/g, path.sep);

			for (const priorityDir of normalizedPriorityDirs) {
				const aNormDir = path.sep + priorityDir.replace(/\//g, path.sep) + path.sep;
				const bNormDir = path.sep + priorityDir.replace(/\//g, path.sep) + path.sep;
				const aMatches = aPath.includes(aNormDir);
				const bMatches = bPath.includes(bNormDir);

				if (aMatches && !bMatches) {
					return -1;
				}
				if (!aMatches && bMatches) {
					return 1;
				}
				if (aMatches && bMatches) {
					return 0; // Both in same priority dir, keep original order
				}
			}
			return 0;
		});

		// Return priority files first, then regular files
		return [...priorityFiles, ...regularFiles];
	}

	private async parseFileIfNeeded(uri: Uri): Promise<void> {
		try {
			const stat = fs.statSync(uri.fsPath);
			const currentMtime = stat.mtimeMs;
			const cachedMtime = this.fileModTimes.get(uri.fsPath);
			const timeoutMs = this.getFileIndexTimeoutMs();

			// If file is in cache and hasn't changed, skip it
			if (cachedMtime !== undefined && cachedMtime === currentMtime && this.cache.has(uri.fsPath)) {
				return;
			}

			const symbols = await this.withTimeout(
				this.extractSymbolsFromDocument(uri),
				timeoutMs
			);

			if (!symbols) {
				const warningMessage = `RubyNavigate: Skipped indexing for '${uri.fsPath}' because it took longer than ${timeoutMs}ms.`;
				console.warn(warningMessage);
				void window.showWarningMessage(warningMessage);
				return;
			}

			this.cache.set(uri.fsPath, symbols);
			this.fileModTimes.set(uri.fsPath, currentMtime);
		} catch (e) {
			// Skip files that can't be parsed
		}
	}

	private getFileIndexTimeoutMs(): number {
		const config = workspace.getConfiguration('rubynavigate');
		const configuredTimeout = config.get<number>('fileIndexTimeoutMs', SymbolCache.defaultFileIndexTimeoutMs);
		return Number.isFinite(configuredTimeout) ? Math.max(100, configuredTimeout) : SymbolCache.defaultFileIndexTimeoutMs;
	}

	private async extractSymbolsFromDocument(uri: Uri): Promise<RubySymbol[]> {
		const document = await workspace.openTextDocument(uri);
		const text = document.getText();
		const parsed = parseRubySymbolsFromText(text);
		return parsed.map(entry => {
			const start = document.positionAt(entry.index);
			const end = document.positionAt(entry.index + entry.length);
			return { name: entry.name, uri, range: new Range(start, end), isPrivate: entry.isPrivate };
		});
	}

	private async withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | null> {
		let timeoutHandle: NodeJS.Timeout | undefined;

		try {
			return await Promise.race([
				operation,
				new Promise<null>(resolve => {
					timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
				})
			]);
		} finally {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
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
			return { name: entry.name, uri, range: new Range(start, end), isPrivate: entry.isPrivate };
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
