import { createWriteStream } from 'node:fs';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'node:https';
import { execFileSync } from 'node:child_process';

const dir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(dir, '..');
const backendDir = join(rootDir, 'backend');
const sidecarDir = join(rootDir, 'frontend', 'backend-sidecar');

const PYTHON_VERSION = '3.12.12';
const RELEASE_TAG = '20260211';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

const platform = process.platform;
const arch = process.arch;
const forceClean = process.argv.includes('--clean');
const PYTHON_STAMP_VALUE = `${PYTHON_VERSION}+${RELEASE_TAG}-${arch}-${platform}`;

const archMap = {
  arm64: 'aarch64',
  x64: 'x86_64',
};

const platformMap = {
  darwin: 'apple-darwin',
};

function pythonUrl() {
  const mappedArch = archMap[arch];
  const mappedPlatform = platformMap[platform];
  if (!mappedArch || !mappedPlatform) {
    throw new Error(`Unsupported platform: ${arch}/${platform}`);
  }
  const name = `cpython-${PYTHON_VERSION}+${RELEASE_TAG}-${mappedArch}-${mappedPlatform}-install_only_stripped.tar.gz`;
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE_TAG}/${name}`;
}

function pythonBin() {
  return join(sidecarDir, 'python', 'bin', 'python3');
}

function pythonStampPath() {
  return join(sidecarDir, '.python-stamp');
}

function downloadFile(url, outputPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        downloadFile(response.headers.location, outputPath)
          .then(resolvePromise)
          .catch(rejectPromise);
        return;
      }

      if (response.statusCode !== 200) {
        rejectPromise(new Error(`Download failed (${response.statusCode}): ${url}`));
        return;
      }

      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolvePromise();
      });
      file.on('error', rejectPromise);
    });

    request.on('error', rejectPromise);
  });
}

function downloadPython() {
  const archivePath = join(sidecarDir, 'python.tar.gz');
  const url = pythonUrl();
  console.log(`Downloading Python ${PYTHON_VERSION}...`);
  return downloadFile(url, archivePath)
    .then(() => {
      execFileSync('tar', ['-xzf', archivePath, '-C', sidecarDir], {
        stdio: 'inherit',
      });
      rmSync(archivePath, { force: true });

      if (!existsSync(pythonBin())) {
        throw new Error(`Python binary not found at ${pythonBin()}`);
      }

      writeFileSync(pythonStampPath(), `${PYTHON_STAMP_VALUE}\n`);
    });
}

async function installPip() {
  console.log('Installing pip...');
  const getPipPath = join(sidecarDir, 'get-pip.py');
  await downloadFile(GET_PIP_URL, getPipPath);

  try {
    execFileSync(
      pythonBin(),
      [getPipPath, '--disable-pip-version-check'],
      { stdio: 'inherit' }
    );
  } finally {
    rmSync(getPipPath, { force: true });
  }
}

function depsStampPath() {
  return join(sidecarDir, '.deps-stamp');
}

function depsStampValue() {
  const requirements = readFileSync(join(dir, 'requirements.txt'), 'utf-8');
  return JSON.stringify({ requirements, python: PYTHON_STAMP_VALUE });
}

function pythonUpToDate() {
  const stamp = pythonStampPath();
  if (!existsSync(pythonBin()) || !existsSync(stamp)) return false;
  return readFileSync(stamp, 'utf-8').trim() === PYTHON_STAMP_VALUE;
}

function depsUpToDate() {
  const stamp = depsStampPath();
  if (!existsSync(stamp)) return false;
  try {
    const installed = JSON.parse(readFileSync(stamp, 'utf-8'));
    return installed.requirements === readFileSync(join(dir, 'requirements.txt'), 'utf-8') &&
      installed.python === PYTHON_STAMP_VALUE;
  } catch {
    return false;
  }
}

async function installDeps() {
  try {
    execFileSync(pythonBin(), ['-m', 'pip', '--version'], { stdio: 'ignore' });
  } catch {
    await installPip();
  }
  console.log('Installing dependencies...');
  execFileSync(
    pythonBin(),
    [
      '-m',
      'pip',
      'install',
      '-q',
      '--disable-pip-version-check',
      '--no-warn-script-location',
      '-r',
      join(dir, 'requirements.txt'),
    ],
    {
      cwd: backendDir,
      stdio: 'inherit',
    }
  );
  writeFileSync(depsStampPath(), depsStampValue());
}

function copySource() {
  console.log('Copying source...');
  const pycacheFilter = (src) => !src.includes('__pycache__') && !src.endsWith('.pyc');
  rmSync(join(sidecarDir, 'app'), { recursive: true, force: true });
  rmSync(join(sidecarDir, 'migrations'), { recursive: true, force: true });

  cpSync(join(backendDir, 'app'), join(sidecarDir, 'app'), {
    recursive: true,
    filter: pycacheFilter,
  });
  cpSync(join(backendDir, 'migrations'), join(sidecarDir, 'migrations'), {
    recursive: true,
    filter: pycacheFilter,
  });
  copyFileSync(join(backendDir, 'alembic.ini'), join(sidecarDir, 'alembic.ini'));
  copyFileSync(join(backendDir, 'migrate.py'), join(sidecarDir, 'migrate.py'));
  copyFileSync(join(backendDir, 'permission_server.py'), join(sidecarDir, 'permission_server.py'));
  copyFileSync(join(dir, 'entry.py'), join(sidecarDir, 'entry.py'));
}

function writeLauncher() {
  const launcher = join(sidecarDir, 'claudex-backend');
  writeFileSync(
    launcher,
    '#!/bin/bash\n' +
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n' +
      'export PYTHONPATH="$SCRIPT_DIR"\n' +
      'exec "$SCRIPT_DIR/python/bin/python3" "$SCRIPT_DIR/entry.py" "$@"\n'
  );
  chmodSync(launcher, 0o755);
}

async function run() {
  if (platform !== 'darwin') {
    throw new Error(`Desktop build currently supports macOS only (received: ${platform})`);
  }

  if (forceClean && existsSync(sidecarDir)) {
    rmSync(sidecarDir, { recursive: true, force: true });
  }
  mkdirSync(sidecarDir, { recursive: true });

  const pythonChanged = !pythonUpToDate();
  if (pythonChanged) {
    rmSync(join(sidecarDir, 'python'), { recursive: true, force: true });
    await downloadPython();
  } else {
    console.log('Python already installed, skipping download.');
  }

  if (!pythonChanged && depsUpToDate()) {
    console.log('Dependencies up to date, skipping install.');
  } else {
    await installDeps();
  }

  copySource();
  writeLauncher();
  console.log('Done');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
