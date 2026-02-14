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

	test('Finds nested classes with qualified outer class', () => {
		const text = [
			'class Foo::Bar',
			'  class Baz',
			'  end',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('Foo::Bar'));
		assert.ok(names.includes('Foo::Bar::Baz'));

		assert.strictEqual(matchesRubySymbol('Foo::Bar', 'Foo::B'), true);
		assert.strictEqual(matchesRubySymbol('Foo::Bar', 'Foo::Bar'), true);

		assert.strictEqual(matchesRubySymbol('Foo::Bar::Baz', 'Baz'), true);
		assert.strictEqual(matchesRubySymbol('Foo::Bar::Baz', 'Foo::Bar::Baz'), true);
		assert.strictEqual(matchesRubySymbol('Foo::Bar::Baz', 'Baz::Foo'), false);
		assert.strictEqual(matchesRubySymbol('Foo::Bar::Baz', 'Foo::Baz'), false);
	});

		test('Root lookups honor leading :: prefixes', () => {
			assert.strictEqual(matchesRubySymbol('Foo::Bar', '::Foo::Bar'), true);
			assert.strictEqual(matchesRubySymbol('Foo::Bar::Baz', '::Foo::Bar::Baz'), true);
			assert.strictEqual(matchesRubySymbol('Baz::Foo::Bar', '::Foo::Bar'), false);
			assert.strictEqual(matchesRubySymbol('Baz::Foo::Bar', 'Foo::Bar'), true);
		});
});
