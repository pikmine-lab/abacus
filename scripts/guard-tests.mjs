#!/usr/bin/env node
// baudrier guard-tests, version 4.
//
// Detects changes to test files made after a snapshot, and requires one reason
// per changed file. The script protects itself the same way. It serves the
// test-first module of the baudrier plugin.
//
// This is a reference script: the harness-setup skill copies it into a project
// and adapts the parts marked ADAPT. Keep the version line above so a review
// can tell how far a copy has drifted from the reference.
//
// Usage:
//   node guard-tests.mjs snapshot
//   node guard-tests.mjs check [--reason <file>=<reason>]...

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ADAPT: what counts as a protected file in this project, as a path relative
// to the repository root. Include whatever decides which tests run and how
// (runner config, the test script, a CI file that holds the test command) when
// changing it could make failing tests pass.
// Here: the root package.json holds the test script, ci.yml the CI test command.
function isProtected(file) {
  return (
    /(^|\/)(test|tests|__tests__)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    file === 'package.json' ||
    file === '.github/workflows/ci.yml'
  );
}

// ADAPT: where the snapshot is stored. Inside the git directory by default:
// never versioned, and separate for each worktree.
function snapshotPath(cwd) {
  return join(git(cwd, 'rev-parse', '--absolute-git-dir'), 'baudrier-guard-tests.json');
}

const USAGE = 'usage: guard-tests.mjs snapshot | check [--reason <file>=<reason>]...';

class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function git(cwd, ...args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    throw new Failure(2, `git ${args.join(' ')} failed in ${cwd}: run inside a git repository.`);
  }
}

// This script's path relative to the repository root, so that changing the
// guard itself counts as a protected change.
function self(root) {
  const path = relative(realpathSync(root), realpathSync(fileURLToPath(import.meta.url)));
  return path.split(sep).join('/');
}

function fingerprints(cwd) {
  const root = git(cwd, 'rev-parse', '--show-toplevel');
  const script = self(root);
  const files = git(root, 'ls-files', '--cached', '--others', '--exclude-standard')
    .split('\n')
    .filter((file) => file && (isProtected(file) || file === script));
  const result = {};
  for (const file of files) {
    const path = join(root, file);
    if (existsSync(path)) {
      result[file] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  }
  return result;
}

function changes(before, after) {
  const result = [];
  for (const file of Object.keys(after)) {
    if (!(file in before)) result.push({ file, kind: 'added' });
    else if (before[file] !== after[file]) result.push({ file, kind: 'modified' });
  }
  for (const file of Object.keys(before)) {
    if (!(file in after)) result.push({ file, kind: 'removed' });
  }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}

function parseReasons(args) {
  const reasons = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--reason') throw new Failure(2, `unknown argument: ${args[i]}`);
    const value = args[++i] ?? '';
    const at = value.indexOf('=');
    if (at <= 0) throw new Failure(2, `--reason expects <file>=<reason>, got: ${value}`);
    reasons[value.slice(0, at)] = value.slice(at + 1).trim();
  }
  return reasons;
}

function snapshot(cwd) {
  writeFileSync(snapshotPath(cwd), JSON.stringify(fingerprints(cwd), null, 2));
  return 'guard-tests: snapshot taken.\n';
}

function readSnapshot(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof data === 'object' && data !== null) return data;
  } catch {
    // Unreadable or not JSON: reported below, like any other corruption.
  }
  throw new Failure(
    2,
    `the snapshot is corrupted (${path}).\n` +
      'Take a new one only once the tests are back to their reviewed state.',
  );
}

function check(cwd, args) {
  const reasons = parseReasons(args);
  if (!existsSync(snapshotPath(cwd))) {
    throw new Failure(2, 'no snapshot. Take one with `snapshot` before development starts.');
  }
  const before = readSnapshot(snapshotPath(cwd));
  const found = changes(before, fingerprints(cwd));
  const changed = new Set(found.map((c) => c.file));

  const errors = [];
  for (const [file, reason] of Object.entries(reasons)) {
    if (!changed.has(file)) errors.push(`reason given for ${file}, which did not change.`);
    else if (!reason) errors.push(`empty reason for ${file}.`);
  }
  const missing = found.filter((c) => !reasons[c.file]);
  if (missing.length) {
    const list = missing.map((c) => `  ${c.kind.padEnd(9)} ${c.file}`).join('\n');
    const example = missing.map((c) => `--reason ${c.file}="<why>"`).join(' ');
    errors.push(
      `tests changed since the snapshot, without a reason:\n${list}\n` +
        'Undo each change, or justify it, one reason per file:\n' +
        `  node ${relative(realpathSync(cwd), realpathSync(fileURLToPath(import.meta.url)))} check ${example}`,
    );
  }
  if (errors.length) throw new Failure(1, errors.join('\n'));

  if (!found.length) return 'guard-tests: no test changed since the snapshot.\n';
  const rows = found.map((c) => `| ${c.file} | ${c.kind} | ${reasons[c.file]} |`);
  return ['| File | Change | Reason |', '|---|---|---|', ...rows].join('\n') + '\n';
}

// Runs one command and returns its exit code and output, without exiting.
export function main(args, cwd = process.cwd()) {
  const [command, ...rest] = args;
  try {
    if (command === 'snapshot') return { code: 0, out: snapshot(cwd), err: '' };
    if (command === 'check') return { code: 0, out: check(cwd, rest), err: '' };
    throw new Failure(2, USAGE);
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    return { code: error.code, out: '', err: `guard-tests: ${error.message}\n` };
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out, err } = main(process.argv.slice(2));
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
