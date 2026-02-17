import * as assert from 'assert';

import { matchesRubySymbol, parseRubySymbolsFromText, compareMatches, isClassOrModule } from '../../rubyParser';

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

	test('Sorts results: exact match first', () => {
		// Exact match should come before prefix and substring matches
		assert.strictEqual(compareMatches('User::Admin', 'User::Admin', 'User::Admin'), 0);
		assert.strictEqual(compareMatches('User::Admin', 'User::AdminB', 'User::Admin') < 0, true);
		assert.strictEqual(compareMatches('User::Admin', 'User::AdminCount', 'User::Admin') < 0, true);
		assert.strictEqual(compareMatches('User::Admin', 'SuperUser::Admin', 'User::Admin') < 0, true);
	});

	test('Sorts results: prefix matches come before substring matches', () => {
		// Prefix match (User::AdminX) should come before substring match (SuperUser::Admin)
		assert.strictEqual(compareMatches('User::AdminB', 'SuperUser::Admin', 'User::Admin') < 0, true);
		assert.strictEqual(compareMatches('User::AdminHelper', 'SuperUser::Admin', 'User::Admin') < 0, true);
	});

	test('Sorts results: shorter prefix matches come before longer ones', () => {
		// When both are prefix matches, shorter is better (closer match)
		assert.strictEqual(compareMatches('User::Admin', 'User::AdminHelper', 'User::Admin') < 0, true);
		assert.strictEqual(compareMatches('User::AdminB', 'User::AdminCount', 'User::Admin') < 0, true);

		// Length comparison
		assert.strictEqual(compareMatches('Foo', 'FooBar', 'Foo') < 0, true);
	});

	test('Sorts results: earlier substring matches come before later ones', () => {
		// Both contain 'Admin' but not at start. Index 1 should come before index 8
		assert.strictEqual(compareMatches('ZAdminUser', 'SomeZoneAdmin', 'Admin') < 0, true);
		// 'Admin' at position 1 vs position 8
		assert.strictEqual(compareMatches('MAdminPost', 'PostAdmin', 'Admin') < 0, true);
	});

	test('Sorts results: for same substring index, shorter names win', () => {
		// Both have 'Admin' at same position (0), but different lengths
		// Actually, if they both start with Admin, shorter is better (tested above)
		// This test case will have both match at same position but different lengths
		assert.strictEqual(compareMatches('AdminX', 'AdminXYZ', 'Admin') < 0, true);
	});

	test('Class with multiple scopes: all scopes found', () => {
		const text = [
			'class Post < ApplicationRecord',
			'  scope :published, -> { where(status: :published) }',
			'  scope :draft, -> { where(status: :draft) }',
			'  scope :archived, -> { where(archived: true) }',
			'  scope :recent, -> { order(created_at: :desc) }',
			'  scope :featured, -> { where(featured: true) }',
			'  scope :pending, -> { where(status: :pending) }',
			'  scope :active, -> { where(active: true) }',
			'end',
			''
		].join('\n');
		const names = parseRubySymbolsFromText(text).map(symbol => symbol.name);

		// Verify class and all 7 scopes are parsed
		assert.ok(names.includes('Post'));
		assert.ok(names.includes('Post.published'));
		assert.ok(names.includes('Post.draft'));
		assert.ok(names.includes('Post.archived'));
		assert.ok(names.includes('Post.recent'));
		assert.ok(names.includes('Post.featured'));
		assert.ok(names.includes('Post.pending'));
		assert.ok(names.includes('Post.active'));
		assert.strictEqual(names.length, 8); // 1 class + 7 scopes
	});

	test('Class with scopes: empty search shows only class', () => {
		const all = ['Post', 'Post.published', 'Post.draft', 'Post.archived', 'Post.recent', 'Post.featured', 'Post.pending', 'Post.active'];

		// When filtering with empty search, only classes/modules should appear
		// Use the actual isClassOrModule function to filter
		const classesOnly = all.filter(name => isClassOrModule(name));
		assert.deepStrictEqual(classesOnly, ['Post']);
	});

	test('Class with scopes: searching for class shows class first, then all scopes', () => {
		const scopes = ['Post.published', 'Post.draft', 'Post.archived', 'Post.recent', 'Post.featured', 'Post.pending', 'Post.active'];
		const className = 'Post';
		const allSymbols = [className, ...scopes];

		// Filter matches using the actual matchesRubySymbol function
		const matches = allSymbols.filter(name => matchesRubySymbol(name, 'Post'));
		assert.strictEqual(matches.length, 8);

		// Sort using the actual compareMatches function
		matches.sort((a, b) => compareMatches(a, b, 'Post'));

		// Class should be first (exact match)
		assert.strictEqual(matches[0], 'Post');

		// All scopes should follow
		const resultingScopes = matches.slice(1);
		assert.strictEqual(resultingScopes.length, 7);

		// Verify they're all scope entries
		for (const scope of resultingScopes) {
			assert.ok(scope.includes('.'));
		}
	});

	test('Class with scopes: searching for scope pattern returns scopes sorted by compareMatches', () => {
		const scopes = ['Post.published', 'Post.draft', 'Post.archived', 'Post.recent', 'Post.featured', 'Post.pending', 'Post.active'];
		const className = 'Post';
		const allSymbols = [className, ...scopes];

		// Filter matches for 'Post.'
		const matches = allSymbols.filter(name => matchesRubySymbol(name, 'Post.'));
		assert.strictEqual(matches.length, 7); // Only scopes, not the class

		// Sort using the actual compareMatches function (which sorts prefix matches by length)
		matches.sort((a, b) => compareMatches(a, b, 'Post.'));

		// Verify sorted by length: shorter names come first
		// Post.draft(10) < Post.recent(11) < Post.active(11) < Post.pending(12) < Post.archived(13) < Post.featured(13) < Post.published(14)
		const expected = ['Post.draft', 'Post.recent', 'Post.active', 'Post.pending', 'Post.archived', 'Post.featured', 'Post.published'];
		assert.deepStrictEqual(matches, expected);
	});
});