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

	test('Finds constants in classes', () => {
		const text = [
			'class Foo',
			'  BAR = [:test].freeze',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('Foo'));
		assert.ok(names.includes('Foo::BAR'));

		assert.strictEqual(matchesRubySymbol('Foo::BAR', 'Foo::BAR'), true);
		assert.strictEqual(matchesRubySymbol('Foo::BAR', 'BAR'), true);
		assert.strictEqual(matchesRubySymbol('Foo::BAR', 'Foo::B'), true);
	});

	test('Finds constants in nested classes', () => {
		const text = [
			'module Foo',
			'  QWER = "lalala"',
			'  class Bar',
			'    BAZ = "value"',
			'    QUX = 123',
			'  end',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('Foo'));
		assert.ok(names.includes('Foo::QWER'));
		assert.ok(names.includes('Foo::Bar'));
		assert.ok(names.includes('Foo::Bar::BAZ'));
		assert.ok(names.includes('Foo::Bar::QUX'));

		// Verify that Foo:: finds all symbols under Foo namespace (including Foo itself)
		const fooNamespaceSymbols = names.filter(name => matchesRubySymbol(name, 'Foo::'));
		assert.ok(fooNamespaceSymbols.includes('Foo'));
		assert.ok(fooNamespaceSymbols.includes('Foo::Bar'));
		assert.ok(fooNamespaceSymbols.includes('Foo::QWER'));
		assert.ok(fooNamespaceSymbols.includes('Foo::Bar::BAZ'));
		assert.ok(fooNamespaceSymbols.includes('Foo::Bar::QUX'));
		assert.strictEqual(fooNamespaceSymbols.length, 5); // Foo + 4 nested symbols

		// Verify that both QWER and qwer find the constant
		assert.strictEqual(matchesRubySymbol('Foo::QWER', 'QWER'), true);
		assert.strictEqual(matchesRubySymbol('Foo::QWER', 'qwer'), true);

		// Verify that ::Foo (absolute lookup) finds the module Foo
		assert.strictEqual(matchesRubySymbol('Foo', '::Foo'), true);
		assert.strictEqual(matchesRubySymbol('Foo::Bar', '::Foo'), true);
		assert.strictEqual(matchesRubySymbol('Foo::QWER', '::Foo'), true);
		assert.strictEqual(matchesRubySymbol('Foo::Bar', '::Foo'), true);
		assert.strictEqual(matchesRubySymbol('Foo::Bar::BAZ', '::Foo'), true);
		assert.strictEqual(matchesRubySymbol('Foo::Bar::QUX', '::Foo'), true);
	});

	test('Finds top-level constants', () => {
		const text = [
			'TOP_LEVEL = "test"',
			'',
			'class Foo',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('TOP_LEVEL'));
		assert.ok(names.includes('Foo'));
	});
});