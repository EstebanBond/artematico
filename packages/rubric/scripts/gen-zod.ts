import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { jsonSchemaToZod } from 'json-schema-to-zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.dirname(__dirname);

const schemaPath = path.join(packageRoot, 'rubric.schema.json');
const outputPath = path.join(packageRoot, 'generated', 'rubric.zod.ts');

// Ensure generated directory exists
const generatedDir = path.dirname(outputPath);
if (!fs.existsSync(generatedDir)) {
  fs.mkdirSync(generatedDir, { recursive: true });
}

// Read the schema
const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
const schema = JSON.parse(schemaContent);

// Resolve $ref references inline to handle nested definitions
function resolveRefs(obj: any, defs: any): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveRefs(item, defs));
  }

  if (obj.$ref) {
    const refPath = obj.$ref.replace('#/$defs/', '');
    const resolved = defs[refPath];
    if (!resolved) {
      throw new Error(`Could not resolve $ref: ${obj.$ref}`);
    }
    return resolveRefs({ ...resolved }, defs);
  }

  const resolved: any = {};
  for (const [key, value] of Object.entries(obj)) {
    resolved[key] = resolveRefs(value, defs);
  }
  return resolved;
}

// Resolve all refs in the schema
const resolvedSchema = resolveRefs(schema, schema.$defs || {});

// Generate Zod schema
const zodCode = jsonSchemaToZod(resolvedSchema, {
  module: 'esm',
  name: 'RubricSchema',
  type: true,
});

// Prepend the "do not edit" comment
const output = `// GENERADO por scripts/gen-zod.ts a partir de rubric.schema.json. No editar a mano.
${zodCode}`;

// Write the output
fs.writeFileSync(outputPath, output, 'utf-8');
console.log(`✓ Generated Zod schema at ${outputPath}`);
