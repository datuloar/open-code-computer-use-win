import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readField, readFrontmatter } from '../lib/frontmatter.js';

test('readFrontmatter returns the block without the fences', () => {
  assert.equal(readFrontmatter('---\nname: a\n---\n\n# body'), 'name: a');
});

test('readFrontmatter returns null when a document has none', () => {
  assert.equal(readFrontmatter('# no frontmatter'), null);
});

test('readField reads a plain scalar', () => {
  const field = readField('name: dsh-computer-use', 'name');
  assert.deepEqual(field, { value: 'dsh-computer-use', style: 'plain' });
});

test('readField strips quotes and keeps their contents', () => {
  const field = readField('description: "a: b"', 'description');
  assert.deepEqual(field, { value: 'a: b', style: 'quoted' });
});

test('readField folds a block scalar the way YAML does', () => {
  const field = readField('description: >-\n  first line\n  second line\nname: x', 'description');
  assert.deepEqual(field, { value: 'first line second line', style: 'block' });
});

test('readField reads a literal block scalar', () => {
  const field = readField('description: |\n  first\n  second\n', 'description');
  assert.equal(field.value, 'first second');
});

test('readField stops at the first line that is not indented', () => {
  const field = readField('description: >-\n  text\nname: other\n  not part of description', 'description');
  assert.equal(field.value, 'text');
});

test('readField returns null for a field that is absent', () => {
  assert.equal(readField('name: a', 'description'), null);
});

test('readField only matches the key it was asked for', () => {
  const field = readField('when-to-use: b\nname: a', 'name');
  assert.equal(field.value, 'a');
});
