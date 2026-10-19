export function readFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  return match ? match[1] : null;
}

export function readField(frontmatter, key) {
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = new RegExp(`^${key}:[ \\t]*(.*)$`).exec(lines[index]);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline === '' || /^[>|][-+]?$/.test(inline)) {
      return { value: readBlockScalar(lines, index), style: 'block' };
    }
    if (/^".*"$/.test(inline) || /^'.*'$/.test(inline)) {
      return { value: inline.slice(1, -1), style: 'quoted' };
    }
    return { value: inline, style: 'plain' };
  }
  return null;
}

function readBlockScalar(lines, keyIndex) {
  const block = [];
  for (let index = keyIndex + 1; index < lines.length; index++) {
    if (lines[index].trim() === '') continue;
    if (!/^\s/.test(lines[index])) break;
    block.push(lines[index].trim());
  }
  return block.join(' ');
}
