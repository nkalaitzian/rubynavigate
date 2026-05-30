---
name: new-feature
description: 'Implement a new feature end-to-end: code, tests, docs, and version bump. Use when: adding new functionality, implementing a feature request, creating a new command or capability, building a new user-facing feature.'
argument-hint: 'Describe the feature to implement'
---

# New Feature Implementation

## Purpose

Complete end-to-end workflow for implementing a new feature: from code discovery through implementation, testing, documentation, and release preparation.

If the feature is too large to implement in one pass, break it into smaller incremental steps, each with its own test verification, before proceeding to documentation and version bump.

## When to Use

- Adding a new command, capability, or user-facing feature
- Implementing a feature request or enhancement
- Any change that warrants a version bump

If the change is purely internal and not user-facing, skip the version bump step and note why in your response.

## Procedure

### 1. Understand the Feature

- Clarify requirements: what the feature does, edge cases, user-facing behavior
- Identify which layers of the architecture are affected

### 2. Search for Existing Patterns

- Search the codebase for similar functionality that can be reused
- Look for helper functions, utilities, and patterns already established
- Check existing tests for patterns to follow
- Reuse any methods that fit within scope — avoid duplicating logic

### 3. Implement the Feature

- Follow existing code style and conventions (indentation, naming, structure)
- Reuse discovered methods and patterns from Step 2
- Register any new commands/settings in `package.json` if applicable
- Keep changes minimal and focused — don't refactor unrelated code

### 4. Write Tests

- Add tests that exercise the new functionality using real implementation functions (no mocks)
- Follow the existing test pattern: call exported functions directly and assert results
- Cover normal cases, edge cases, and interaction with existing features
- Run the full test suite to ensure no regressions: `npm test`
- If tests fail, diagnose and fix the failure before proceeding. If an existing test breaks, determine whether your change introduced a bug or the test needs updating to reflect new expected behavior.

### 5. Update Documentation

Update the following files with relevant new information:

- **README.md**: Add/update feature descriptions, usage instructions, configuration docs, keyboard shortcuts
- **CHANGELOG.md**: Add entry under `[Unreleased]` or a new version section with `### Added`, `### Changed`, or `### Fixed` as appropriate
- **Copilot instructions** (`.github/copilot-instructions.md`): Update architecture docs, commands list, settings, design decisions, or extension points if the feature changes any of those

### 6. Bump Version and Finalize

1. Bump the version in `package.json` (patch for fixes, minor for features, major for breaking changes to existing APIs or user-facing behavior)
2. Run `npm install` to regenerate `package-lock.json` with the new version
3. Run `npm run compile` to verify the build succeeds. If compilation fails, diagnose and fix type errors or build issues before proceeding. Do not skip this step.
4. Run `npm test` one final time to confirm everything passes
5. If after 3 attempts the build or tests still fail, stop and report the error details to the user for guidance rather than continuing to guess at fixes.

## Checklist

- [ ] Searched codebase for reusable patterns
- [ ] Feature implemented following existing conventions
- [ ] Tests written and passing (`npm test`)
- [ ] README updated with new feature docs
- [ ] CHANGELOG updated with new entry
- [ ] Copilot instructions updated if architecture/commands/settings changed
- [ ] Version bumped in `package.json`
- [ ] `npm install` run to sync `package-lock.json`
- [ ] `npm run compile` succeeds
- [ ] `npm test` passes with no regressions
