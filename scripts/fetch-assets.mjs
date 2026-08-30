/**
 * Downloads the project media listed in assets.manifest.json into
 * src/assets/, then reports each file's real dimensions so the gallery
 * layouts can be authored against actual aspect ratios.
 *
 *   npm run assets            # skips anything already on disk
 *   npm run assets -- --force # re-downloads everything
 */

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(join(root, 'scripts/assets.manifest.json'), 'utf8')
);
const force = process.argv.includes('--force');

/**
 * Guard: if a Tilda optim/thb URL with resize/cover/format ops slips into the
 * manifest, pull the untransformed original from static.tildacdn.net instead.
 * Astro already emits WebP (and the responsive set) at build time.
 */
function original(url) {
  const id = url.match(/\/(tild[0-9a-f-]+)\//i)?.[1];
  const name = url
    .split('/')
    .pop()
    .replace(/\.(webp|avif)$/i, '');
  if (!id || !name) throw new Error(`Cannot parse CDN url: ${url}`);
  return `https://static.tildacdn.net/${id}/${name}`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  if (!force && (await exists(dest))) return 'cached';
  const res = await fetch(original(url));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return 'fetched';
}

const jobs = [];
for (const [slug, project] of Object.entries(manifest.projects)) {
  const dir = join(root, 'src/assets/projects', slug);
  if (project.lead) {
    jobs.push({ ...project.lead, dest: join(dir, project.lead.file), slug });
  }
  for (const item of project.gallery ?? []) {
    jobs.push({ ...item, dest: join(dir, item.file), slug });
  }
}
for (const item of manifest.home?.teasers ?? []) {
  jobs.push({ ...item, dest: join(root, 'src/assets/home', item.file), slug: 'home' });
}

let failed = 0;
for (const job of jobs) {
  try {
    const how = await download(job.url, job.dest);
    const meta = await sharp(job.dest).metadata();
    const ratio = (meta.width / meta.height).toFixed(2);
    const shape = ratio > 1.15 ? 'wide' : ratio < 0.87 ? 'tall' : 'square';
    console.log(
      `${how === 'cached' ? '·' : '↓'} ${job.slug}/${job.file}  ` +
        `${meta.width}x${meta.height}  ${ratio}  ${shape}`
    );
  } catch (err) {
    failed += 1;
    console.error(`✗ ${job.slug}/${job.file}: ${err.message}`);
  }
}

console.log(`\n${jobs.length - failed}/${jobs.length} assets ready`);
if (failed) process.exitCode = 1;
