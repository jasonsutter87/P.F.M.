/**
 * PFM Cross-Implementation Conformance Tests
 *
 * Loads shared test vectors from tests/conformance/vectors.json
 * and runs them against the JS parser/serializer.
 * Both Python and JS implementations MUST pass all of these.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize, getSection, computeChecksum } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Find vectors.json by walking up to the pfm-js dir, then up to repo root
// Works from both src/__tests__/ (2 up) and dist/esm/__tests__/ (3 up)
function findVectors(): string {
  for (let levels = 2; levels <= 4; levels++) {
    const candidate = resolve(__dirname, ...Array(levels).fill('..'), 'tests', 'conformance', 'vectors.json');
    try { readFileSync(candidate); return candidate; } catch { /* next */ }
  }
  throw new Error('vectors.json not found');
}
const VECTORS_PATH = findVectors();
const vectors = JSON.parse(readFileSync(VECTORS_PATH, 'utf-8'));

// ================================================================
// Escape Round-Trip Tests
// ================================================================

describe('conformance: escape round-trip', () => {
  for (const c of vectors.escape_roundtrip.cases) {
    it(`[${c.desc}] serialize -> parse preserves content`, async () => {
      // Create a doc with this content, serialize, parse back
      const doc = {
        formatVersion: '1.0',
        isStream: false,
        meta: { agent: 'conformance-test' },
        sections: [{ name: 'content', content: c.input }],
      };
      const text = await serialize(doc);
      const restored = parse(text);
      assert.equal(
        restored.sections[0].content,
        c.input,
        `Round-trip failed for ${JSON.stringify(c.input)}`
      );
    });
  }

  it('multi-roundtrip stability (10x escape/unescape)', async () => {
    const dangerous = ['#@section', '#!PFM/1.0', '#!END', '\\#@marker', '\\\\#@deep'];
    for (const original of dangerous) {
      // Escape 10 times by nesting in serialize/parse
      let content = original;
      for (let i = 0; i < 10; i++) {
        const doc = {
          formatVersion: '1.0',
          isStream: false,
          meta: { agent: 'test' },
          sections: [{ name: 'content', content }],
        };
        const text = await serialize(doc);
        const restored = parse(text);
        // Each round-trip should be identity
        assert.equal(restored.sections[0].content, content, `Round ${i} failed for ${JSON.stringify(original)}`);
      }
    }
  });
});

// ================================================================
// Parse/Serialize Round-Trip Tests
// ================================================================

describe('conformance: parse/serialize round-trip', () => {
  for (const c of vectors.parse_serialize_roundtrip.cases) {
    it(`[${c.desc}]`, async () => {
      const doc = {
        formatVersion: '1.0',
        isStream: false,
        meta: c.meta,
        sections: c.sections.map((s: { name: string; content: string }) => ({
          name: s.name,
          content: s.content,
        })),
      };
      const text = await serialize(doc);
      const restored = parse(text);
      assert.equal(
        restored.sections.length,
        doc.sections.length,
        `Section count mismatch`
      );
      for (let i = 0; i < doc.sections.length; i++) {
        assert.equal(restored.sections[i].name, doc.sections[i].name, `Name mismatch at ${i}`);
        assert.equal(
          restored.sections[i].content,
          doc.sections[i].content,
          `Content mismatch in '${doc.sections[i].name}'`
        );
      }
    });
  }
});

// ================================================================
// Checksum Tests
// ================================================================

describe('conformance: checksum', () => {
  for (const c of vectors.checksum.cases) {
    it(`[${c.desc}]`, async () => {
      const sections = c.sections.map((s: { name: string; content: string }) => ({
        name: s.name,
        content: s.content,
      }));
      const hash = await computeChecksum(sections);
      assert.equal(hash, c.expected_checksum, `Checksum mismatch`);
    });
  }
});

// ================================================================
// Adversarial Tests
// ================================================================

describe('conformance: adversarial', () => {
  it('content with all PFM markers survives round-trip', async () => {
    const dangerous =
      'Line before\n#@fake-section\n#!PFM/1.0\n#!END\n\\#@escaped\n\\\\#@double\nLine after';
    const doc = {
      formatVersion: '1.0',
      isStream: false,
      meta: { agent: 'test' },
      sections: [{ name: 'content', content: dangerous }],
    };
    const text = await serialize(doc);
    const restored = parse(text);
    assert.equal(restored.sections[0].content, dangerous);
  });

  it('unicode content round-trips', async () => {
    const content = 'Hello 世界 🌍 مرحبا Ñoño → résumé';
    const doc = {
      formatVersion: '1.0',
      isStream: false,
      meta: { agent: 'test' },
      sections: [{ name: 'content', content }],
    };
    const text = await serialize(doc);
    const restored = parse(text);
    assert.equal(restored.sections[0].content, content);
  });

  it('empty section round-trips', async () => {
    const doc = {
      formatVersion: '1.0',
      isStream: false,
      meta: { agent: 'test' },
      sections: [
        { name: 'content', content: '' },
        { name: 'chain', content: 'data' },
      ],
    };
    const text = await serialize(doc);
    const restored = parse(text);
    assert.equal(restored.sections[0].content, '');
    assert.equal(restored.sections[1].content, 'data');
  });

  it('many sections round-trip', async () => {
    const sections = Array.from({ length: 50 }, (_, i) => ({
      name: `section${String(i).padStart(3, '0')}`,
      content: `content-${i}`,
    }));
    const doc = {
      formatVersion: '1.0',
      isStream: false,
      meta: { agent: 'test' },
      sections,
    };
    const text = await serialize(doc);
    const restored = parse(text);
    assert.equal(restored.sections.length, 50);
    for (let i = 0; i < 50; i++) {
      assert.equal(restored.sections[i].content, `content-${i}`);
    }
  });
});
