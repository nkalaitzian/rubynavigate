import * as assert from 'assert';

import { matchesRubySymbol, parseRubySymbolsFromText } from '../../rubyParser';

suite('Ruby symbol detection', () => {
	test('Finds simple class and matches filter terms', () => {
		const text = ['class Foo', 'end', ''].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('Foo'));

		assert.strictEqual(matchesRubySymbol('Foo', 'Foo'), true);
		assert.strictEqual(matchesRubySymbol('Foo', 'Fo'), true);
		assert.strictEqual(matchesRubySymbol('Foo', 'F'), true);
		assert.strictEqual(matchesRubySymbol('Foo', 'Fpp'), false);
	});

	test('Finds nested classes in a module', () => {
		const text = [
			'module Foo',
			'  class Bar',
			'  end',
			'',
			'  class Par',
			'  end',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('Foo::Bar'));
		assert.ok(names.includes('Foo::Par'));
	});
});
