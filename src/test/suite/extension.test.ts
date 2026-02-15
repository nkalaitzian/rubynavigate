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

	test('Finds Rails scopes in classes', () => {
		const text = [
			'class User < ApplicationRecord',
			'  scope :active, -> { where(active: true) }',
			'  scope :inactive, -> { where(active: false) }',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('User'));
		assert.ok(names.includes('User.active'));
		assert.ok(names.includes('User.inactive'));

		// Verify matching with full qualified name
		assert.strictEqual(matchesRubySymbol('User.active', 'User.active'), true);
		assert.strictEqual(matchesRubySymbol('User.active', 'user.active'), true);
		
		// Verify matching with partial name
		assert.strictEqual(matchesRubySymbol('User.active', 'active'), true);
		assert.strictEqual(matchesRubySymbol('User.inactive', 'inactive'), true);
		
		// Verify matching with class prefix (finds all scopes)
		assert.strictEqual(matchesRubySymbol('User.active', 'User.'), true);
		assert.strictEqual(matchesRubySymbol('User.inactive', 'User.'), true);
	});

	test('Finds scopes in nested classes', () => {
		const text = [
			'module Admin',
			'  class User < ApplicationRecord',
			'    scope :admin_users, -> { where(role: "admin") }',
			'    scope :regular_users, -> { where(role: "user") }',
			'  end',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('Admin'));
		assert.ok(names.includes('Admin::User'));
		assert.ok(names.includes('Admin::User.admin_users'));
		assert.ok(names.includes('Admin::User.regular_users'));

		// Verify that Admin::User. finds all scopes
		const userScopes = names.filter(name => matchesRubySymbol(name, 'Admin::User.'));
		assert.ok(userScopes.includes('Admin::User.admin_users'));
		assert.ok(userScopes.includes('Admin::User.regular_users'));
		assert.strictEqual(userScopes.length, 2);
	});

	test('Finds mixed symbols: classes, constants, and scopes', () => {
		const text = [
			'class Post < ApplicationRecord',
			'  STATUS = [:draft, :published].freeze',
			'  scope :published, -> { where(status: :published) }',
			'  scope :draft, -> { where(status: :draft) }',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);
		assert.ok(names.includes('Post'));
		assert.ok(names.includes('Post::STATUS'));
		assert.ok(names.includes('Post.published'));
		assert.ok(names.includes('Post.draft'));
		
		// Verify all symbols can be found with 'Post.'
		const postScopes = names.filter(name => matchesRubySymbol(name, 'Post.'));
		assert.ok(postScopes.includes('Post.published'));
		assert.ok(postScopes.includes('Post.draft'));
		assert.strictEqual(postScopes.length, 2); // Only scopes, not constants
	});
});