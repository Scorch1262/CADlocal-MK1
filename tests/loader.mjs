// Node-Loader: bildet die absoluten Browser-Pfade (/vendor/...) auf web/vendor ab
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/vendor/')) return { url: pathToFileURL(path.join(root, 'web', specifier)).href, shortCircuit: true };
  return next(specifier, context);
}
