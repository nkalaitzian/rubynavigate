export type RubyParsedSymbol = {
  name: string;
  index: number;
  length: number;
};

export function parseRubySymbolsFromText(text: string): RubyParsedSymbol[] {
  const symbols: RubyParsedSymbol[] = [];
  const declRegex = /^\s*(class|module)\s+([A-Z][A-Za-z0-9]*(?:::[A-Z][A-Za-z0-9]*)*)/;
  const constantRegex = /^\s*([A-Z][A-Z0-9_]*)\s*=/;
  const scopeRegex = /^\s*scope\s+:([a-z_][a-z0-9_]*)/i;
  const otherBlockRegex = /^\s*(def|if|unless|case|while|until|for|begin|do)\b/;
  const classShovelRegex = /^\s*class\s+<</;
  const endRegex = /^\s*end\b/;

  const lines = text.split(/\r?\n/);
  let offset = 0;
  const stack: Array<{ type: 'class' | 'module' | 'other'; name?: string; absolute?: boolean }> = [];

  for (const line of lines) {
    if (endRegex.test(line)) {
      if (stack.length > 0) {
        stack.pop();
      }
      offset += line.length + 1;
      continue;
    }

    if (classShovelRegex.test(line)) {
      stack.push({ type: 'other' });
      offset += line.length + 1;
      continue;
    }

    const declMatch = declRegex.exec(line);
    if (declMatch) {
      const kind = declMatch[1] as 'class' | 'module';
      const rawName = declMatch[2];
      const isQualified = rawName.includes('::');
      const prefix = isQualified ? [] : getPrefix(stack);
      const fullName = [...prefix, rawName].join('::');
      const nameIndexInLine = declMatch.index + declMatch[0].lastIndexOf(rawName);
      const nameIndex = offset + nameIndexInLine;
      symbols.push({ name: fullName, index: nameIndex, length: rawName.length });
      stack.push({ type: kind, name: fullName, absolute: isQualified });
      offset += line.length + 1;
      continue;
    }

    const constantMatch = constantRegex.exec(line);
    if (constantMatch) {
      const constantName = constantMatch[1];
      const currentNamespace = getCurrentNamespace(stack);
      const fullName = currentNamespace ? `${currentNamespace}::${constantName}` : constantName;
      const nameIndexInLine = constantMatch.index + constantMatch[0].indexOf(constantName);
      const nameIndex = offset + nameIndexInLine;
      symbols.push({ name: fullName, index: nameIndex, length: constantName.length });
      offset += line.length + 1;
      continue;
    }

    const scopeMatch = scopeRegex.exec(line);
    if (scopeMatch) {
      const scopeName = scopeMatch[1];
      const currentNamespace = getCurrentNamespace(stack);
      // Use . for scopes instead of :: (e.g., User.active instead of User::active)
      const fullName = currentNamespace ? `${currentNamespace}.${scopeName}` : scopeName;
      const nameIndexInLine = scopeMatch.index + scopeMatch[0].indexOf(scopeName);
      const nameIndex = offset + nameIndexInLine;
      symbols.push({ name: fullName, index: nameIndex, length: scopeName.length });
      offset += line.length + 1;
      continue;
    }

    if (otherBlockRegex.test(line)) {
      stack.push({ type: 'other' });
    }

    offset += line.length + 1;
  }

  return symbols;
}

function getPrefix(stack: Array<{ name?: string; absolute?: boolean }>): string[] {
  let startIndex = 0;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i].absolute) {
      startIndex = i;
      break;
    }
  }

  const names: string[] = [];
  for (let i = startIndex; i < stack.length; i += 1) {
    if (stack[i].name) {
      names.push(stack[i].name as string);
    }
  }

  return names;
}

function getCurrentNamespace(stack: Array<{ type: 'class' | 'module' | 'other'; name?: string }>): string | undefined {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if ((stack[i].type === 'class' || stack[i].type === 'module') && stack[i].name) {
      return stack[i].name;
    }
  }
  return undefined;
}

export function matchesRubySymbol(name: string, term: string): boolean {
  const normalized = term.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  const absoluteLookup = normalized.startsWith('::');
  const target = absoluteLookup ? normalized.slice(2) : normalized;
  
  // Handle namespace search (e.g., "Foo::" should match "Foo" and "Foo::Bar")
  if (target.endsWith('::')) {
    const namespace = target.slice(0, -2);
    const nameLower = name.toLowerCase();
    // Match the namespace itself or anything starting with namespace::
    return nameLower === namespace || nameLower.startsWith(namespace + '::');
  }

  // Handle scope search (e.g., "Foo." should match "Foo.bar", "Foo.baz")
  if (target.endsWith('.')) {
    const namespace = target.slice(0, -1);
    const nameLower = name.toLowerCase();
    // Match anything starting with namespace.
    return nameLower.startsWith(namespace + '.');
  }
  
  if (absoluteLookup) {
    return name.toLowerCase().startsWith(target);
  }
  return name.toLowerCase().includes(target);
}

/**
 * Compare two symbols for sorting by match quality.
 * Sorts by: exact match > prefix match > substring match
 * Within each category, earlier/shorter matches are prioritized.
 */
export function compareMatches(nameA: string, nameB: string, searchTerm: string): number {
	const normalized = searchTerm.trim().toLowerCase();
	const lowerA = nameA.toLowerCase();
	const lowerB = nameB.toLowerCase();
	
	// Exact match comes first
	const aIsExact = lowerA === normalized;
	const bIsExact = lowerB === normalized;
	if (aIsExact && !bIsExact) return -1;
	if (bIsExact && !aIsExact) return 1;
	if (aIsExact && bIsExact) return 0;
	
	// Prefix match (starts with search term)
	const aStartsWith = lowerA.startsWith(normalized);
	const bStartsWith = lowerB.startsWith(normalized);
	if (aStartsWith && !bStartsWith) return -1;
	if (bStartsWith && !aStartsWith) return 1;
	
	// For prefix matches, shorter names are better (closer match)
	if (aStartsWith && bStartsWith) {
		return nameA.length - nameB.length;
	}
	
	// Substring match (contains search term)
	const aIndex = lowerA.indexOf(normalized);
	const bIndex = lowerB.indexOf(normalized);
	const aHasSubstring = aIndex !== -1;
	const bHasSubstring = bIndex !== -1;
	
	if (aHasSubstring && !bHasSubstring) return -1;
	if (bHasSubstring && !aHasSubstring) return 1;
	
	// For substring matches, earlier occurrence is better
	if (aHasSubstring && bHasSubstring) {
		if (aIndex !== bIndex) {
			return aIndex - bIndex;
		}
		// Same position, shorter names are better
		return nameA.length - nameB.length;
	}
	
	// No match (shouldn't happen)
	return 0;
}
