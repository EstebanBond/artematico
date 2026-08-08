import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { RubricSchema } from '../generated/rubric.zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('RubricSchema round-trip', () => {
  const validFixture = JSON.parse(
    readFileSync(path.join(__dirname, '../fixtures/valid-example.json'), 'utf-8')
  );

  const invalidFixture = JSON.parse(
    readFileSync(path.join(__dirname, '../fixtures/invalid-example.json'), 'utf-8')
  );

  it('should parse valid example', () => {
    const result = RubricSchema.safeParse(validFixture);
    expect(result.success).toBe(true);
  });

  it('should reject invalid example (missing bandera_para_papa)', () => {
    const result = RubricSchema.safeParse(invalidFixture);
    expect(result.success).toBe(false);
  });
});
