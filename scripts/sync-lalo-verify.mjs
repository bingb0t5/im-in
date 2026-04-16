import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'src', 'generated', 'lalo-verify');
const tempOutputDir = `${outputDir}.tmp`;

let envLoaded = false;

function parseEnvLine(rawLine) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) return null;
  const equalsIndex = line.indexOf('=');
  if (equalsIndex <= 0) return null;
  const key = line.slice(0, equalsIndex).trim();
  if (!key) return null;
  let value = line.slice(equalsIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

async function loadEnvFiles() {
  if (envLoaded) return;
  envLoaded = true;
  const envFiles = ['.env', '.env.local'];
  for (const fileName of envFiles) {
    const envPath = path.join(repoRoot, fileName);
    let raw = '';
    try {
      raw = await readFile(envPath, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (process.env[parsed.key] == null || process.env[parsed.key] === '') {
        process.env[parsed.key] = parsed.value;
      }
    }
  }
}

function normalizeBaseUrl(raw) {
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function normalizeManifestUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  return rawUrl.replace('/public/lalo-verify/', '/lalo-verify/');
}

function resolveManifestUrl() {
  const explicit = (process.env.LALO_VERIFY_MANIFEST_URL || process.env.VITE_LALO_VERIFY_MANIFEST_URL || '').trim();
  if (explicit) {
    return normalizeManifestUrl(explicit);
  }
  const platformBaseUrl = normalizeBaseUrl((process.env.PLATFORM_PUBLIC_BASE_URL || '').trim());
  const base = normalizeBaseUrl(
    (process.env.LALO_VERIFY_BASE_URL || process.env.VITE_LALO_VERIFY_BASE_URL || '').trim(),
  );
  const version = (process.env.LALO_VERIFY_VERSION || process.env.VITE_LALO_VERIFY_VERSION || 'latest').trim();
  if (base) {
    return `${base}/${version}/manifest.json`;
  }
  if (platformBaseUrl) {
    return `${platformBaseUrl}/lalo-verify/${version}/manifest.json`;
  }
  throw new Error('Set LALO_VERIFY_MANIFEST_URL, LALO_VERIFY_BASE_URL, or PLATFORM_PUBLIC_BASE_URL before syncing lalo-verify.');
}

function assertSafeRelativePath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Unsafe manifest file path: ${filePath}`);
  }
  return normalized;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest (${response.status} ${response.statusText}) from ${url}`);
  }
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    const sample = body.slice(0, 120).replace(/\s+/g, ' ').trim();
    if (sample.startsWith('<')) {
      throw new Error(
        `Manifest response was HTML, not JSON (${url}). This usually means the llalo path is missing and returned index.html.`,
      );
    }
    throw new Error(`Manifest response is not valid JSON (${url}).`);
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch artifact file (${response.status} ${response.statusText}) from ${url}`);
  }
  return response.text();
}

async function writeArtifactFile(relativePath, contents) {
  const targetPath = path.join(tempOutputDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents, 'utf8');
}

async function moveTempIntoPlace() {
  await rm(outputDir, { recursive: true, force: true });
  try {
    await rename(tempOutputDir, outputDir);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/EPERM|EACCES/i.test(message)) {
      throw error;
    }
  }

  await mkdir(outputDir, { recursive: true });
  await cp(tempOutputDir, outputDir, { recursive: true, force: true });
  await rm(tempOutputDir, { recursive: true, force: true });
}

async function hasUsableLocalArtifact() {
  const manifestPath = path.join(outputDir, 'manifest.json');
  try {
    await access(manifestPath);
  } catch {
    return null;
  }

  try {
    const manifestRaw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
      return null;
    }

    for (const file of manifest.files) {
      const relativePath = assertSafeRelativePath(String(file));
      await access(path.join(outputDir, relativePath));
    }
    return manifest;
  } catch {
    return null;
  }
}

async function syncFromRemote() {
  await loadEnvFiles();
  const manifestUrl = resolveManifestUrl();
  const manifest = await fetchJson(manifestUrl);

  if (!Array.isArray(manifest?.files) || manifest.files.length === 0) {
    throw new Error(`Invalid manifest from ${manifestUrl}: expected a non-empty files array.`);
  }

  const artifactBaseUrl = new URL('./', manifestUrl).toString();
  await rm(tempOutputDir, { recursive: true, force: true });
  await mkdir(tempOutputDir, { recursive: true });

  for (const rawPath of manifest.files) {
    const relativePath = assertSafeRelativePath(String(rawPath));
    const fileUrl = new URL(relativePath, artifactBaseUrl).toString();
    const contents = await fetchText(fileUrl);
    await writeArtifactFile(relativePath, contents);
  }

  await writeArtifactFile('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  await moveTempIntoPlace();

  process.stdout.write(
    `Synced lalo-verify artifact ${manifest.version || 'unknown'} (${manifest.files.length} files) from ${manifestUrl}\n`,
  );
}

async function main() {
  try {
    await syncFromRemote();
  } catch (error) {
    await rm(tempOutputDir, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    const fallbackManifest = await hasUsableLocalArtifact();
    if (fallbackManifest) {
      process.stderr.write(`[sync:lalo-verify] ${message}\n`);
      process.stdout.write(
        `Using cached lalo-verify artifact ${fallbackManifest.version || 'unknown'} from src/generated/lalo-verify\n`,
      );
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[sync:lalo-verify] ${message}\n`);
  process.exitCode = 1;
});
