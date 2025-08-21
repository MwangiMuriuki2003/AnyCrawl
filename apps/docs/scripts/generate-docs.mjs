import { generateFiles } from 'fumadocs-openapi';
import { rimraf } from 'rimraf';

await rimraf('./content/docs/openapi/(generated)');

void generateFiles({
    // the OpenAPI schema
    // For Vercel users, we recommend a URL instead.
    input: ['./openapi.json'],
    output: './content/docs/openapi/(generated)',
    per: 'tag',
    // we recommend to enable it
    // make sure your endpoint description doesn't break MDX syntax.
    includeDescription: true,
});
