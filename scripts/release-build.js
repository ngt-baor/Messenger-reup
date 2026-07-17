#!/usr/bin/env node
'use strict';

/**
 * Đóng gói app Windows (NSIS installer ± portable) cho kiểm thử từng phase / release.
 *
 * Usage:
 *   node scripts/release-build.js
 *   node scripts/release-build.js --phase 1
 *   node scripts/release-build.js --phase 2 --bump patch
 *   node scripts/release-build.js --version 1.2.0 --portable
 *   node scripts/release-build.js --clean
 *   node scripts/release-build.js --publish   # chỉ khi muốn đẩy GitHub Releases
 *
 * npm:
 *   npm run pack
 *   npm run pack -- --phase 1
 *   npm run pack -- --phase 3 --bump patch --portable
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const DIST_DIR = path.join(ROOT, 'dist');

function parseArgs(argv) {
  const out = {
    phase: null,
    bump: null,
    version: null,
    portable: false,
    clean: false,
    publish: false,
    skipInstall: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--phase' || a === '-p') out.phase = String(argv[++i] ?? '');
    else if (a === '--bump' || a === '-b') out.bump = String(argv[++i] ?? '');
    else if (a === '--version' || a === '-v') out.version = String(argv[++i] ?? '');
    else if (a === '--portable') out.portable = true;
    else if (a === '--clean') out.clean = true;
    else if (a === '--publish') out.publish = true;
    else if (a === '--skip-install') out.skipInstall = true;
    else if (a.startsWith('--phase=')) out.phase = a.slice('--phase='.length);
    else if (a.startsWith('--bump=')) out.bump = a.slice('--bump='.length);
    else if (a.startsWith('--version=')) out.version = a.slice('--version='.length);
    else {
      console.error(`Unknown argument: ${a}`);
      out.help = true;
    }
  }

  if (out.phase === '') out.phase = null;
  if (out.bump === '') out.bump = null;
  if (out.version === '') out.version = null;

  return out;
}

function printHelp() {
  console.log(`
Messenger release / phase pack

  node scripts/release-build.js [options]

Options:
  --phase, -p <id>     Tag build theo phase (vd: 1, 2, 3a). Copy artifact vào dist/phases/phase-<id>/
  --bump, -b <level>   Tăng version: patch | minor | major (ghi package.json)
  --version, -v <semver>
                       Đặt version cụ thể (vd: 1.2.0-phase.1)
  --portable           Thêm bản portable (electron-builder --win portable)
  --clean              Xoa toan bo dist/ truoc khi build
  --publish            Publish GitHub Releases (mặc định: KHÔNG publish)
  --skip-install       Bỏ npm install
  --help, -h           Help

Examples:
  npm run pack
  npm run pack -- --phase 1
  npm run pack -- --phase 2 --bump patch
  npm run pack -- --version 1.2.0-discord.mvp --portable
  npm run pack:portable
`);
}

function readPkg() {
  return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
}

function writePkg(pkg) {
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function parseSemver(version) {
  const m = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || '',
    build: m[5] || '',
  };
}

function formatSemver(parts) {
  let v = `${parts.major}.${parts.minor}.${parts.patch}`;
  if (parts.prerelease) v += `-${parts.prerelease}`;
  if (parts.build) v += `+${parts.build}`;
  return v;
}

function bumpVersion(current, level) {
  const parts = parseSemver(current);
  if (!parts) throw new Error(`Invalid current version: ${current}`);
  if (!['patch', 'minor', 'major'].includes(level)) {
    throw new Error(`Invalid --bump level: ${level} (use patch|minor|major)`);
  }
  // Bump clears prerelease/build for a clean release number
  if (level === 'major') {
    parts.major += 1;
    parts.minor = 0;
    parts.patch = 0;
  } else if (level === 'minor') {
    parts.minor += 1;
    parts.patch = 0;
  } else {
    parts.patch += 1;
  }
  parts.prerelease = '';
  parts.build = '';
  return formatSemver(parts);
}

function run(command, args, opts = {}) {
  console.log(`\n> ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...opts.env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
}

function rmDirSafe(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listArtifacts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => {
      const lower = name.toLowerCase();
      return (
        lower.endsWith('.exe') ||
        lower.endsWith('.blockmap') ||
        lower === 'latest.yml' ||
        lower.endsWith('.yml')
      );
    })
    .sort();
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function writeBuildMeta({ version, phase, portable, publish, pkgName }) {
  const meta = {
    app: pkgName,
    version,
    phase: phase || null,
    portable,
    publish,
    builtAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  const metaPath = path.join(DIST_DIR, 'build-meta.json');
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return metaPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.bump && args.version) {
    console.error('Use either --bump or --version, not both.');
    process.exit(1);
  }

  if (args.bump && !['patch', 'minor', 'major'].includes(args.bump)) {
    console.error(`Invalid --bump: ${args.bump}`);
    process.exit(1);
  }

  if (args.version && !parseSemver(args.version)) {
    console.error(`Invalid --version: ${args.version} (expect semver, e.g. 1.2.0 or 1.2.0-phase.1)`);
    process.exit(1);
  }

  const started = Date.now();
  let pkg = readPkg();
  const previousVersion = pkg.version;
  let nextVersion = previousVersion;

  if (args.bump) {
    nextVersion = bumpVersion(previousVersion, args.bump);
    pkg.version = nextVersion;
    writePkg(pkg);
    console.log(`Version bumped: ${previousVersion} → ${nextVersion}`);
  } else if (args.version) {
    nextVersion = args.version;
    pkg.version = nextVersion;
    writePkg(pkg);
    console.log(`Version set: ${previousVersion} → ${nextVersion}`);
  } else {
    console.log(`Version unchanged: ${nextVersion}`);
  }

  if (args.phase) {
    console.log(`Phase tag: ${args.phase}`);
  }

  if (args.clean) {
    console.log('Cleaning dist/ ...');
    rmDirSafe(DIST_DIR);
  }


  if (!args.skipInstall) {
    run('npm', ['install']);
  }

  // electron-builder args
  const ebArgs = ['electron-builder', '--win'];
  if (args.portable) {
    // NSIS (from package.json win.target) + portable
    ebArgs.push('nsis', 'portable');
  }
  if (args.publish) {
    ebArgs.push('--publish', 'always');
  } else {
    ebArgs.push('--publish', 'never');
  }

  run('npx', ebArgs);

  const metaPath = writeBuildMeta({
    version: nextVersion,
    phase: args.phase,
    portable: args.portable,
    publish: args.publish,
    pkgName: pkg.productName || pkg.name,
  });

  const artifacts = listArtifacts(DIST_DIR);
  let phaseDir = null;

  if (args.phase) {
    const safePhase = String(args.phase).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
    phaseDir = path.join(DIST_DIR, 'phases', `phase-${safePhase}`, `v${nextVersion}`);
    ensureDir(phaseDir);

    for (const name of artifacts) {
      copyFile(path.join(DIST_DIR, name), path.join(phaseDir, name));
    }
    copyFile(metaPath, path.join(phaseDir, 'build-meta.json'));

    const note = [
      `# Phase ${safePhase} build`,
      '',
      `- Version: ${nextVersion}`,
      `- Built at: ${new Date().toISOString()}`,
      `- Exclusive publish: ${args.publish ? 'yes' : 'no (local only)'}`,
      '',
      'Artifacts:',
      ...artifacts.map((n) => `- ${n}`),
      '',
      'Install the .exe and smoke-test this phase before continuing.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, 'PHASE_NOTES.md'), note, 'utf8');
  }

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);

  console.log('\n========== BUILD OK ==========');
  console.log(`Version:  ${nextVersion}`);
  if (args.phase) console.log(`Phase:    ${args.phase}`);
  console.log(`Elapsed:  ${elapsedSec}s`);
  console.log(`Meta:     ${path.relative(ROOT, metaPath)}`);
  console.log('Artifacts (dist/):');
  if (artifacts.length === 0) {
    console.log('  (none matched — check electron-builder log)');
  } else {
    for (const name of artifacts) {
      const full = path.join(DIST_DIR, name);
      const sizeMb = (fs.statSync(full).size / (1024 * 1024)).toFixed(2);
      console.log(`  - ${name}  (${sizeMb} MB)`);
    }
  }
  if (phaseDir) {
    console.log(`Phase copy: ${path.relative(ROOT, phaseDir)}`);
  }
  console.log('==============================\n');
  console.log('Next: cài MessengerSetup-*.exe → kiểm thử phase → tiếp phase sau.');
  if (!args.publish) {
    console.log('Note: chưa publish GitHub. Dùng --publish khi muốn release công khai.');
  }
}

try {
  main();
} catch (err) {
  console.error('\nBUILD FAILED:', err.message || err);
  process.exit(1);
}
