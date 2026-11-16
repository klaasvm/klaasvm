// Usage:
//   node scripts/build.mjs            live data from the GitHub API (uses ORBIT_TOKEN / GITHUB_TOKEN if set)
//   node scripts/build.mjs --sample   offline data from data/sample.json (avatar and colours still fetched if online)
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAvatar, fetchCustomFlags, fetchData, fetchExtras, fetchLanguageColors, pickShips, selectPlanets } from "./fetch.mjs";
import { updateMilestones } from "./milestones.mjs";
import { renderLegend, renderOrbit } from "./render.mjs";

const run = promisify(execFile);
const TEXTURE = 96; // px, planet image size after shrinking

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sample = process.argv.includes("--sample");

const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
const username = process.env.GH_USER || config.username;
const token = process.env.ORBIT_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

const data = sample
  ? JSON.parse(await readFile(join(root, "data", "sample.json"), "utf8"))
  : await fetchData({ username, token, privateInclude: config.privateInclude ?? [] });

const { planets, belt } = selectPlanets(data.repos, { ...config, username });
const images = await loadPlanetImages(join(root, "planets"));
for (const p of planets) p.image = images.get(p.name.toLowerCase())?.uri;
const unused = [...images.values()].filter((img) => !planets.some((p) => p.image === img.uri)).map((img) => img.file);
if (unused.length) console.warn(`warning: planets/ images without a planet: ${unused.join(", ")}`);

const extras = sample
  ? { lastCommit: data.lastCommit ?? null, stargazers: data.recentStars ?? [] }
  : await fetchExtras({ planets, belt, token, username, hideCommits: config.hideCommits ?? [], satelliteDays: config.satelliteDays ?? 2 });
await fetchCustomFlags(planets);
const comet = extras.lastCommit;
const stargazers = extras.stargazers;
const [avatar, colors] = await Promise.all([fetchAvatar(data.user.login), fetchLanguageColors()]);
const ships = pickShips(planets, { max: config.maxShips ?? 16, seed: new Date().toISOString().slice(0, 10) });
const pilotAvatars = new Map(await Promise.all([...new Set(ships.map((s) => s.login))].map(async (l) => [l, await fetchAvatar(l, 48)])));
for (const s of ships) s.avatar = pilotAvatars.get(s.login);

console.log(`${data.user.login}: ${planets.length} planets -> ${planets.map((p) => p.name).join(", ") || "(none)"}`);
console.log(`custom images: ${planets.filter((p) => p.image).map((p) => p.name).join(", ") || "none"}`);
console.log(`ships: ${ships.map((s) => `@${s.login} -> ${planets[s.target].name} (${s.turn + 1}/${s.turns})`).join(", ") || "none"}, pages dishes: ${planets.filter((p) => p.pages).map((p) => p.name).join(", ") || "none"}`);
console.log(`satellites: ${planets.filter((p) => p.ci).map((p) => `${p.name} (${p.ci})`).join(", ") || "none"}, shooting stars: ${stargazers.map((s) => `@${s.login} -> ${s.repo}`).join(", ") || "none"}`);
const flare = (data.user.commits24h ?? 0) >= (config.flareCommits ?? 15);
const milestones = sample
  ? (data.milestones ?? [])
  : await updateMilestones(join(root, "data", "milestones.json"), {
      followers: data.user.followers,
      stars: [...planets, ...belt].reduce((n, r) => n + r.stars, 0),
      contributions: data.user.contributions,
      contributors: extras.contributorCount,
    });
console.log(`milestones: ${milestones.map((m) => m.label).join(", ") || "none this week"} (contributors: ${extras.contributorCount ?? "?"})`);
console.log(`commits last 24h: ${data.user.commits24h ?? "unknown (needs a token)"}, solar flare: ${flare ? "yes" : "no"}, links: ${(config.links ?? []).map((l) => l.join(" <-> ")).join(", ") || "none"}`);
console.log(`flags: ${planets.map((p) => (p.customFlag ? `${p.name} ${p.customFlag} (custom)` : p.latestRelease ? `${p.name} ${p.latestRelease.tag}` : null)).filter(Boolean).join(", ") || "none"}, station: ${data.user.recentWeeks ? "yes" : "no (needs a token)"}`);
console.log(`belt: ${belt.length} asteroids, comet: ${comet ? comet.repo : "none"}, avatar: ${avatar ? "yes" : "no"}, colours: ${Object.keys(colors).length || "fallback"}`);

await mkdir(join(root, "assets"), { recursive: true });
const orbit = renderOrbit({ user: data.user, planets, belt, comet, ships, stargazers, avatar, colors, flare, milestones, links: config.links ?? [] });
await writeFile(join(root, "assets", "orbit.svg"), orbit);
console.log(`wrote assets/orbit.svg (${Math.round(orbit.length / 1024)} KB)`);
// the legend sits on the README itself, so it follows GitHub's light/dark mode
for (const theme of ["dark", "light"]) {
  await writeFile(join(root, "assets", `legend-${theme}.svg`), renderLegend({ repos: [...planets, ...belt], theme, colors }));
}
console.log("wrote assets/legend-dark.svg and assets/legend-light.svg");

// planets/<repo name>.png (or .jpg, .webp, .gif, .svg) becomes that planet's surface.
// Big raster images are shrunk to a 96px square first (ImageMagick or libvips,
// whichever is installed), because a planet is never more than ~50px on screen.
// The original file is left alone.
async function loadPlanetImages(dir) {
  const types = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
  const images = new Map();
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return images;
  }
  for (const file of files.sort()) {
    const m = /^(.+)\.([a-z]+)$/i.exec(file);
    const ext = m?.[2].toLowerCase();
    if (!types[ext]) continue;
    const path = join(dir, file);
    let buf = await readFile(path);
    let type = types[ext];
    if (buf.length > 24 * 1024 && ["png", "jpg", "jpeg", "webp"].includes(ext)) {
      const small = await shrink(path);
      if (small) [buf, type] = [small.buf, small.type];
    }
    if (buf.length > 150 * 1024) {
      console.warn(`warning: planets/${file} is ${Math.round(buf.length / 1024)} KB and couldn't be shrunk (install ImageMagick or libvips); a ~128x128 image keeps the SVG light`);
    }
    images.set(m[1].toLowerCase(), { file, uri: `data:${type};base64,${buf.toString("base64")}` });
  }
  return images;
}

async function shrink(file) {
  const dir = await mkdtemp(join(tmpdir(), "orbit-"));
  try {
    for (const [ext, type] of [["webp", "image/webp"], ["png", "image/png"]]) {
      const out = join(dir, `planet.${ext}`);
      const im = [file, "-strip", "-resize", `${TEXTURE}x${TEXTURE}^`, "-gravity", "center", "-extent", `${TEXTURE}x${TEXTURE}`, "-quality", "82", out];
      const attempts = [
        ["magick", im],
        ["convert", im],
        ["vips", ["thumbnail", file, `${out}[Q=82]`, String(TEXTURE), "--height", String(TEXTURE), "--crop", "centre"]],
      ];
      for (const [cmd, args] of attempts) {
        try {
          await run(cmd, args);
          const buf = await readFile(out);
          if (buf.length) return { buf, type };
        } catch {
          // tool missing or no support for this format, try the next one
        }
      }
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
