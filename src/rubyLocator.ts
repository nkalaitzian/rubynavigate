import { workspace, Uri, Range } from 'vscode';
import { parseRubySymbolsFromText, RubyParsedSymbol } from './rubyParser';
import { SymbolCache } from './symbolCache';

let symbolCache: SymbolCache | null = null;

export function setSymbolCache(cache: SymbolCache) {
	symbolCache = cache;
}

function getExcludePattern(): string {
	const config = workspace.getConfiguration('rubynavigate');
	const excludeDirs = config.get<string[]>('excludeDirectories', ['node_modules', '.git', 'vendor', 'tmp', 'dist', 'out']);
	if (excludeDirs.length === 0) {
		return '';
	}
	return `**/{${excludeDirs.join(',')}}/**`;
}

export type RubyLocation = {
  uri: Uri;
  range?: Range;
};

export type RubySymbol = RubyLocation & {
  name: string;
  isPrivate?: boolean;
};


export function classNameToRelativePath(className: string): string {
  const normalized = className.replace(/^::/, '').trim();
  const parts = normalized.split('::').filter(Boolean);
  const pathParts = parts.map(part => camelToSnake(part));
  return `${pathParts.join('/')}.rb`;
}

export async function findRubyLocations(className: string): Promise<RubyLocation[]> {
	const excludePattern = getExcludePattern();
	const expectedPath = classNameToRelativePath(className);
	// First try direct, common Rails-like locations to catch top-level classes quickly
	const commonPrefixes = ['app/models', 'app/controllers', 'app/services', 'lib', 'app/models/concerns'];
	for (const p of commonPrefixes) {
		const prefixedMatches = await workspace.findFiles(`${p}/${expectedPath}`, excludePattern, 50);
		if (prefixedMatches.length > 0) {
			return prefixedMatches.map(uri => ({ uri }));
		}
	}

	// Fallback to a general search across the workspace
	const directMatches = await workspace.findFiles(`**/${expectedPath}`, excludePattern);
	if (directMatches.length > 0) {
		return directMatches.map(uri => ({ uri }));
	}

	return await findByDeclaration(className);
}

export async function listRubySymbols(): Promise<RubySymbol[]> {
	// Use cache if available
	if (symbolCache) {
		if (symbolCache.isIndexingActive()) {
			return symbolCache.getAllSymbols();
		}
		await symbolCache.ensureIndexed();
		return symbolCache.getAllSymbols();
	}

	// Fallback to direct scanning if cache not initialized
	const excludePattern = getExcludePattern();
	const files = await workspace.findFiles('**/*.rb', excludePattern);
	const symbols: RubySymbol[] = [];

	for (const uri of files) {
		const document = await workspace.openTextDocument(uri);
		const text = document.getText();
		const parsed = parseRubySymbolsFromText(text);
		for (const entry of parsed) {
			const start = document.positionAt(entry.index);
			const end = document.positionAt(entry.index + entry.length);
			symbols.push({ name: entry.name, uri, range: new Range(start, end) });
		}
	}

	return symbols;
}


async function findByDeclaration(className: string): Promise<RubyLocation[]> {
  const target = className.replace(/^::/, '').trim();
  const symbols = await listRubySymbols();
  return symbols
    .filter(symbol => symbol.name === target)
    .map(symbol => ({ uri: symbol.uri, range: symbol.range }));
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

