#!/usr/bin/env node
/**
 * check-undefined — scans src/ for identifiers that are used but never
 * imported or declared, and for bare identifiers that are *called* even
 * though their binding is an object (e.g. `statusMeta(...)` where
 * `statusMeta` is an object map — a real incident that crashed the Bookings
 * page at runtime).
 *
 * The Vite build does not type-check, so both mistake classes compile fine
 * and only explode behind an ErrorBoundary. This is a fast Babel AST pass.
 *
 * Run:  node scripts/check-undefined.mjs          (reports, exit 0)
 *       node scripts/check-undefined.mjs --strict (exit 1 on findings)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default || traverseModule;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

const GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'console', 'URL', 'URLSearchParams', 'Blob', 'FormData', 'File', 'FileReader', 'Image',
  'Date', 'Math', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Promise',
  'Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp', 'Symbol', 'BigInt', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'customElements',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'FocusEvent', 'PointerEvent', 'TouchEvent', 'WheelEvent',
  'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'HTMLAnchorElement', 'HTMLButtonElement',
  'Element', 'Node', 'Document', 'Text', 'Comment',
  'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'crypto', 'performance',
  'structuredClone', 'matchMedia', 'queueMicrotask', 'getComputedStyle',
  'process', 'Buffer', '__dirname', '__filename', 'module', 'require', 'exports', 'globalThis',
  'alert', 'confirm', 'prompt', 'screen', 'Notification', 'Audio',
  // Language literals that are identifiers at the AST level.
  'undefined', 'NaN', 'Infinity',
  // Further browser globals reached through feature detection or SDK scripts.
  'Intl', 'Uint8Array', 'Uint32Array', 'Float32Array', 'ArrayBuffer', 'DataView',
  'DOMParser', 'XMLSerializer', 'atob', 'btoa', 'self', 'top', 'parent', 'frames',
  'open', 'close', 'print', 'scrollTo', 'getSelection', 'WebSocket', 'EventSource',
  'MessageChannel', 'MessagePort', 'ReadableStream', 'WritableStream', 'TransformStream',
  'Response', 'Request', 'Headers', 'DataTransfer', 'ClipboardItem', 'Razorpay',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (EXTS.has(full.slice(full.lastIndexOf('.')))) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(SRC);
const findings = [];

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'importAttributes', 'topLevelAwait', 'classProperties'],
    });
  } catch {
    continue; // parse errors are caught by the build itself
  }

  const report = (name, line, detail) => {
    const short = file.replace(ROOT, '');
    findings.push(`${short}:${line}  —  ${detail}`);
  };

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (!t.isIdentifier(callee)) return;
      const name = callee.name;
      if (GLOBALS.has(name)) return;
      if (!path.scope.hasBinding(name)) {
        // The general ReferencedIdentifier pass reports this as unbound.
        return;
      }
      // Called as a function while its binding is an object (e.g. statusMeta).
      const binding = path.scope.getBinding(name);
      const init = binding?.path?.node?.init;
      if (t.isObjectExpression(init)) {
        report(name, callee.loc?.start?.line ?? 0, `\`${name}\` is an object (object literal) but is being called like a function`);
      }
    },
    // Any identifier read that is not a global and has no binding in scope is
    // a runtime ReferenceError waiting to happen (e.g. a `policy` that was
    // never declared). The build cannot see this; only an AST pass can.
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (!name || GLOBALS.has(name)) return;
      if (path.scope.hasBinding(name)) return;
      report(name, path.node.loc?.start?.line ?? 0, `\`${name}\` is used but never imported or declared`);
    },
    JSXIdentifier(path) {
      const name = path.node.name;
      const parent = path.parentPath;
      const isTag = parent?.isJSXOpeningElement() || parent?.isJSXClosingElement();
      if (!isTag || !name || !/^[A-Z]/.test(name)) return;
      if (GLOBALS.has(name)) return;
      if (!path.scope.hasBinding(name)) {
        report(name, path.node.loc?.start?.line ?? 0, `JSX component <${name}> is used but never imported or declared`);
      }
    },
  });
}

findings.sort((a, b) => a.localeCompare(b));
if (findings.length) {
  console.log(`\ncheck-undefined: ${findings.length} finding${findings.length === 1 ? '' : 's'}\n`);
  for (const f of findings) console.log('  ' + f);
  console.log('');
  if (process.argv.includes('--strict')) process.exit(1);
} else {
  console.log('check-undefined: no undefined references or object-as-function calls found.');
}
