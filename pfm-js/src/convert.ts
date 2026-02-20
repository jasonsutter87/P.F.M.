/**
 * PFM Converters — Convert PFM documents to JSON and Markdown.
 */

import type { PFMDocument } from './types.js';

/**
 * Convert a PFM document to a JSON string.
 *
 * @param doc - A parsed PFMDocument.
 * @param indent - JSON indentation (default: 2).
 * @returns Pretty-printed JSON string.
 */
export function toJSON(doc: PFMDocument, indent = 2): string {
  return JSON.stringify(
    {
      pfm_version: doc.formatVersion,
      meta: doc.meta,
      sections: doc.sections.map((s) => ({
        name: s.name,
        content: s.content,
      })),
    },
    null,
    indent
  );
}

/** Keys that must never be set on objects from untrusted input. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Parse a PFM JSON export back into a PFMDocument.
 *
 * Validates input structure and rejects prototype pollution attempts.
 *
 * @param json - JSON string (as produced by `toJSON`).
 * @returns A PFMDocument.
 * @throws {Error} If the JSON structure is invalid.
 */
export function fromJSON(json: string): PFMDocument {
  const data = JSON.parse(json);

  // If it's not a PFM-structured export, wrap raw JSON as content
  if (data === null || typeof data !== 'object' || Array.isArray(data) || !('sections' in data)) {
    return {
      formatVersion: '1.0',
      isStream: false,
      meta: { agent: 'json-import', created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
      sections: [{ name: 'content', content: JSON.stringify(data, null, 2) }],
    };
  }

  // Validate and sanitize meta (prevent prototype pollution)
  const rawMeta = data.meta;
  const safeMeta: Record<string, string> = {};
  if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
    for (const [key, val] of Object.entries(rawMeta)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      if (typeof val === 'string') {
        safeMeta[key] = val;
      }
    }
  }

  // Validate and sanitize sections
  const rawSections = Array.isArray(data.sections) ? data.sections : [];
  const VALID_NAME = /^[a-z0-9_-]+$/;
  const RESERVED_NAMES = new Set(['meta', 'index', 'index-trailing']);
  const safeSections = rawSections
    .filter((s: unknown): s is { name: string; content: string } =>
      s !== null &&
      typeof s === 'object' &&
      typeof (s as Record<string, unknown>).name === 'string' &&
      typeof (s as Record<string, unknown>).content === 'string'
    )
    .filter((s: { name: string }) =>
      s.name.length > 0 &&
      s.name.length <= 64 &&
      VALID_NAME.test(s.name) &&
      !RESERVED_NAMES.has(s.name)
    )
    .map((s: { name: string; content: string }) => ({
      name: String(s.name),
      content: String(s.content),
    }));

  const version = typeof data.pfm_version === 'string' ? data.pfm_version : '1.0';
  if (version !== '1.0') {
    throw new Error(`Unsupported PFM format version: '${version}'`);
  }

  return {
    formatVersion: version,
    isStream: false,
    meta: safeMeta,
    sections: safeSections,
  };
}

/**
 * Create a PFM document from plain text.
 * Wraps the entire text as a single "content" section.
 */
export function fromText(text: string): PFMDocument {
  return {
    formatVersion: '1.0',
    isStream: false,
    meta: { agent: 'text-import', created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
    sections: [{ name: 'content', content: text.trim() }],
  };
}

/**
 * Create a PFM document from Markdown.
 * Parses YAML-style frontmatter for meta, ## headers as sections.
 * If no headers found, treats entire content as a single "content" section.
 */
export function fromMarkdown(md: string): PFMDocument {
  const meta: Record<string, string> = { agent: 'markdown-import', created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
  const sections: { name: string; content: string }[] = [];
  const lines = md.split('\n');
  let i = 0;

  // Parse frontmatter
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i].trim() !== '---') {
      const line = lines[i].trim();
      const colonIdx = line.indexOf(': ');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        const val = line.slice(colonIdx + 2).trim();
        if (key && val) meta[key] = val;
      }
      i++;
    }
    i++; // skip closing ---
  }

  // Parse ## sections
  let currentSection: string | null = null;
  let sectionLines: string[] = [];
  const contentBefore: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      if (currentSection) {
        sections.push({ name: currentSection, content: sectionLines.join('\n').trim() });
      } else {
        const pre = contentBefore.join('\n').trim();
        if (pre) sections.push({ name: 'content', content: pre });
      }
      const raw = line.slice(3).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
      currentSection = raw || 'content';
      sectionLines = [];
    } else if (currentSection === null) {
      contentBefore.push(line);
    } else {
      sectionLines.push(line);
    }
    i++;
  }

  // Flush last section
  if (currentSection) {
    sections.push({ name: currentSection, content: sectionLines.join('\n').trim() });
  } else {
    const pre = contentBefore.join('\n').trim();
    if (pre) sections.push({ name: 'content', content: pre });
  }

  // Fallback: if no sections, wrap everything
  if (sections.length === 0) {
    sections.push({ name: 'content', content: md.trim() });
  }

  return { formatVersion: '1.0', isStream: false, meta, sections };
}

/**
 * Create a PFM document from CSV.
 * Expects rows of: type, key, value (meta rows and section rows).
 * If the CSV doesn't follow that schema, wraps raw CSV as content.
 */
export function fromCSV(csvText: string): PFMDocument {
  const lines = csvText.split('\n');
  if (lines.length < 2) {
    return fromText(csvText);
  }

  // Simple CSV parser (handles quoted fields)
  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inQuotes) {
        if (ch === '"' && line[j + 1] === '"') {
          current += '"';
          j++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  }

  // Check if first row looks like a PFM CSV header
  const header = parseLine(lines[0]);
  const isPFMCSV = header.length >= 3 &&
    header[0].trim().toLowerCase() === 'type' &&
    header[1].trim().toLowerCase() === 'key';

  if (!isPFMCSV) {
    // Not PFM-structured CSV — wrap as content
    return {
      formatVersion: '1.0',
      isStream: false,
      meta: { agent: 'csv-import', created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') },
      sections: [{ name: 'content', content: csvText.trim() }],
    };
  }

  const meta: Record<string, string> = { agent: 'csv-import', created: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') };
  const sections: { name: string; content: string }[] = [];

  for (let r = 1; r < lines.length; r++) {
    const line = lines[r].trim();
    if (!line) continue;
    const row = parseLine(line);
    if (row.length < 3) continue;
    const [type, key, value] = row;
    if (type === 'meta' && key) {
      meta[key] = value;
    } else if (type === 'section' && key) {
      sections.push({ name: key, content: value });
    }
  }

  if (sections.length === 0) {
    sections.push({ name: 'content', content: csvText.trim() });
  }

  return { formatVersion: '1.0', isStream: false, meta, sections };
}

/**
 * Convert a PFM document to Markdown.
 *
 * Meta becomes YAML-style frontmatter, sections become ## headers.
 *
 * @param doc - A parsed PFMDocument.
 * @returns Markdown string.
 */
export function toMarkdown(doc: PFMDocument): string {
  const parts: string[] = [];

  // Frontmatter
  const meta = doc.meta;
  const keys = Object.keys(meta);
  if (keys.length > 0) {
    parts.push('---');
    for (const key of keys) {
      if (meta[key]) {
        // Sanitize key: only allow alphanumeric, hyphens, underscores
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        // Sanitize value: replace newlines, escape frontmatter delimiters
        const safeVal = meta[key]!.replace(/\n/g, ' ').replace(/---/g, '\\---');
        parts.push(`${safeKey}: ${safeVal}`);
      }
    }
    parts.push('---');
    parts.push('');
  }

  // Sections (sanitize names to prevent injection via markdown headings)
  for (const section of doc.sections) {
    const safeName = section.name.replace(/[^a-z0-9_-]/g, '_');
    parts.push(`## ${safeName}`);
    parts.push('');
    parts.push(section.content);
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Convert a PFM document to plain text.
 * Section contents with headers, meta as a compact header line.
 */
export function toText(doc: PFMDocument): string {
  const parts: string[] = [];

  // Compact meta header
  const meta = doc.meta;
  const keys = Object.keys(meta).filter(k => k !== 'checksum');
  if (keys.length > 0) {
    const metaLine = keys.map(k => `${k}=${meta[k]}`).join(' | ');
    parts.push(`[${metaLine}]`);
    parts.push('');
  }

  for (const section of doc.sections) {
    parts.push(`=== ${section.name.toUpperCase()} ===`);
    parts.push(section.content);
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Escape a CSV field value to prevent formula injection in spreadsheets.
 */
function escapeCSV(value: string): string {
  const stripped = value.trimStart();
  if (stripped && '=+-@\t\r;'.includes(stripped[0])) {
    return "'" + value;
  }
  return value;
}

/**
 * Convert a PFM document to CSV.
 * Row format: type, key/name, value/content
 */
export function toCSV(doc: PFMDocument): string {
  const rows: string[] = [];
  rows.push('type,key,value');

  function csvRow(type: string, key: string, value: string): string {
    // Quote fields that contain commas, quotes, or newlines
    const fields = [type, key, escapeCSV(value)].map(f => {
      if (f.includes(',') || f.includes('"') || f.includes('\n')) {
        return '"' + f.replace(/"/g, '""') + '"';
      }
      return f;
    });
    return fields.join(',');
  }

  // Meta rows
  for (const [key, val] of Object.entries(doc.meta)) {
    if (val) rows.push(csvRow('meta', key, val));
  }

  // Section rows
  for (const section of doc.sections) {
    rows.push(csvRow('section', section.name, section.content));
  }

  return rows.join('\n') + '\n';
}
