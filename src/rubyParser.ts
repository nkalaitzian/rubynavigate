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
  const stack: Array<{ type: 'class' | 'module' | 'other'; name?: string; absolute?: boolean; symbolIndex?: number }> = [];

  // Detect line ending type for correct offset calculation
  const hasCRLF = text.includes('\r\n');
  const lineEndingLength = hasCRLF ? 2 : 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLastLine = i === lines.length - 1;
    if (endRegex.test(line)) {
      if (stack.length > 0) {
        const popped = stack.pop()!;
        if (typeof popped.symbolIndex === 'number') {
          const symIdx = popped.symbolIndex;
          if (symbols[symIdx]) {
            const symStart = symbols[symIdx].index;
            const endIndex = offset + line.length;
            const newLength = Math.max(symbols[symIdx].length, endIndex - symStart + (isLastLine ? 0 : lineEndingLength));
            symbols[symIdx].length = newLength;
          }
        }
      }
      offset += line.length + (isLastLine ? 0 : lineEndingLength);
      continue;
    }

    if (classShovelRegex.test(line)) {
      stack.push({ type: 'other' });
      offset += line.length + (isLastLine ? 0 : lineEndingLength);
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
      const symbolIndex = symbols.length;
      symbols.push({ name: fullName, index: nameIndex, length: rawName.length });
      // If the declaration and its `end` are on the same line (one-liner), expand the symbol
      // to cover the whole line and do not push it on the stack.
      const afterDecl = line.slice(declMatch.index + declMatch[0].length);
      if (/\bend\b/.test(afterDecl)) {
        // Cover until end of current line so caret anywhere on the line matches
        const newLength = line.length - nameIndexInLine + (isLastLine ? 0 : lineEndingLength);
        symbols[symbolIndex].length = Math.max(symbols[symbolIndex].length, newLength);
      } else {
        stack.push({ type: kind, name: fullName, absolute: isQualified, symbolIndex });
      }
      offset += line.length + (isLastLine ? 0 : lineEndingLength);
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
      offset += line.length + (isLastLine ? 0 : lineEndingLength);
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
      // Scope definitions can open a block with `do` and are closed by `end`.
      // Track that block so its `end` does not accidentally close class/module scope.
      if (/\bdo\b/.test(line)) {
        stack.push({ type: 'other' });
      }
      offset += line.length + (isLastLine ? 0 : lineEndingLength);
      continue;
    }

    // Detect explicit receiver singleton methods: `def User.admins` or `def Foo::Bar.baz`
    const receiverMethodRegex = /^\s*def\s+([A-Z][A-Za-z0-9_:]*)\.([a-zA-Z_][a-zA-Z0-9_]*[!?=]?)/;
    const receiverMethodMatch = receiverMethodRegex.exec(line);
    if (receiverMethodMatch) {
      const receiver = receiverMethodMatch[1];
      const methodName = receiverMethodMatch[2];
      // Use the receiver exactly as written (supports :: qualified names)
      const fullName = `${receiver}.${methodName}`;
      // Capture entire definition from 'def' to end of method name
      const defStartIndex = receiverMethodMatch.index;
      const nameIndex = offset + defStartIndex;
      const entireDefLength = receiverMethodMatch[0].length;
      const symbolIndex = symbols.length;
      symbols.push({ name: fullName, index: nameIndex, length: entireDefLength });
      // If the method definition contains its `end` on the same line (one-liner), expand
      // the symbol to cover the whole line and do not push it on the stack.
      const afterDef = line.slice(receiverMethodMatch.index + receiverMethodMatch[0].length);
      if (/\bend\b/.test(afterDef)) {
        const newLength = line.length - receiverMethodMatch.index + (isLastLine ? 0 : lineEndingLength);
        symbols[symbolIndex].length = Math.max(symbols[symbolIndex].length, newLength);
      } else {
        // Treat method body as block so its `end` doesn't close the containing class/module
        stack.push({ type: 'other', symbolIndex });
      }
      offset += line.length + (isLastLine ? 0 : lineEndingLength);
      continue;
    }

      // Detect class (singleton) methods: `def self.method_name` -> User.method_name
      const classMethodRegex = /^\s*def\s+self\.([a-zA-Z_][a-zA-Z0-9_]*[!?=]?)/;
      const classMethodMatch = classMethodRegex.exec(line);
      if (classMethodMatch) {
        const methodName = classMethodMatch[1];
        const currentNamespace = getCurrentNamespace(stack);
        const fullName = currentNamespace ? `${currentNamespace}.${methodName}` : methodName;
        // Capture entire definition from 'def' to end of method name
        const defStartIndex = classMethodMatch.index;
        const nameIndex = offset + defStartIndex;
        const entireDefLength = classMethodMatch[0].length;
        const symbolIndex = symbols.length;
        symbols.push({ name: fullName, index: nameIndex, length: entireDefLength });
          // If the method definition is a one-liner, expand to cover the whole line and skip stacking
          const afterDef = line.slice(classMethodMatch.index + classMethodMatch[0].length);
          if (/\bend\b/.test(afterDef)) {
            const newLength = line.length - classMethodMatch.index + (isLastLine ? 0 : lineEndingLength);
            symbols[symbolIndex].length = Math.max(symbols[symbolIndex].length, newLength);
          } else {
            // Treat method body as a block so its closing `end` won't close the containing class/module
            stack.push({ type: 'other', symbolIndex });
          }
        offset += line.length + (isLastLine ? 0 : lineEndingLength);
        continue;
      }

      // Detect instance methods: `def method_name` -> User#method_name
      const instanceMethodRegex = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*[!?=]?)/;
      const instanceMethodMatch = instanceMethodRegex.exec(line);
      if (instanceMethodMatch) {
        const methodName = instanceMethodMatch[1];
        const currentNamespace = getCurrentNamespace(stack);
        const fullName = currentNamespace ? `${currentNamespace}#${methodName}` : methodName;
        // Capture entire definition from 'def' to end of method name
        const defStartIndex = instanceMethodMatch.index;
        const nameIndex = offset + defStartIndex;
        const entireDefLength = instanceMethodMatch[0].length;
        const symbolIndex = symbols.length;
        symbols.push({ name: fullName, index: nameIndex, length: entireDefLength });
          // If the instance method is a one-liner, expand to cover the whole line and skip stacking
          const afterDef = line.slice(instanceMethodMatch.index + instanceMethodMatch[0].length);
          if (/\bend\b/.test(afterDef)) {
            const newLength = line.length - instanceMethodMatch.index + (isLastLine ? 0 : lineEndingLength);
            symbols[symbolIndex].length = Math.max(symbols[symbolIndex].length, newLength);
          } else {
            stack.push({ type: 'other', symbolIndex });
          }
        offset += line.length + (isLastLine ? 0 : lineEndingLength);
        continue;
      }

    // Generic Ruby do/end block tracking (e.g., `included do`)
    // so closing `end` does not accidentally pop class/module scope.
    if (/\bdo\b/.test(line) && !/\bend\b/.test(line)) {
      stack.push({ type: 'other' });
      offset += line.length + (isLastLine ? 0 : lineEndingLength);
      continue;
    }

    if (otherBlockRegex.test(line)) {
      stack.push({ type: 'other' });
    }

    offset += line.length + (isLastLine ? 0 : lineEndingLength);
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
  if (aIsExact && !bIsExact) { return -1; }
  if (bIsExact && !aIsExact) { return 1; }
  if (aIsExact && bIsExact) { return 0; }

  // Prefix match (starts with search term)
  const aStartsWith = lowerA.startsWith(normalized);
  const bStartsWith = lowerB.startsWith(normalized);
  if (aStartsWith && !bStartsWith) { return -1; }
  if (bStartsWith && !aStartsWith) { return 1; }

  // For prefix matches, shorter names are better (closer match)
  if (aStartsWith && bStartsWith) {
    return nameA.length - nameB.length;
  }

  // Substring match (contains search term)
  const aIndex = lowerA.indexOf(normalized);
  const bIndex = lowerB.indexOf(normalized);
  const aHasSubstring = aIndex !== -1;
  const bHasSubstring = bIndex !== -1;

  if (aHasSubstring && !bHasSubstring) { return -1; }
  if (bHasSubstring && !aHasSubstring) { return 1; }

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

export function isClassOrModule(symbolName: string): boolean {
	// Scopes always contain a dot
	if (symbolName.includes('.')) {
		return false;
	}

	// Check if it's a constant (ends with UPPERCASE after ::)
	const parts = symbolName.split('::');
	const lastPart = parts[parts.length - 1];
	// If last part is all uppercase, it's a constant
	if (lastPart === lastPart.toUpperCase() && lastPart.length > 0 && /[A-Z]/.test(lastPart)) {
		return false;
	}

	// Otherwise it's a class or module
	return true;
}
