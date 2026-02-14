export type RubyParsedSymbol = {
  name: string;
  index: number;
  length: number;
};

export function parseRubySymbolsFromText(text: string): RubyParsedSymbol[] {
  const symbols: RubyParsedSymbol[] = [];
  const declRegex = /^\s*(class|module)\s+([A-Z][A-Za-z0-9]*(?:::[A-Z][A-Za-z0-9]*)*)/;
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

export function matchesRubySymbol(name: string, term: string): boolean {
  const normalized = term.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  return name.toLowerCase().includes(normalized);
}
