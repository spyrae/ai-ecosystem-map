'use strict';

/**
 * Parse YAML-like frontmatter from markdown files.
 * Zero dependencies — handles the subset used in .claude/ files.
 *
 * Supports:
 *   ---
 *   name: my-skill
 *   description: "Some description"
 *   ---
 */
function parseFrontmatter(content) {
  const result = {};

  if (!content.startsWith('---')) return result;

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) return result;

  const frontmatter = content.substring(3, endIndex).trim();
  const lines = frontmatter.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    // Skip array/object lines (like allowed-tools list items)
    if (value === '' || value === '|' || value === '>') continue;

    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

module.exports = { parseFrontmatter };
