// Renders the "repo orbit" as an animated SVG, plus a language legend for the README.
//
// It is real 3D maths (orbit planes, roll, camera tilt, perspective) baked into
// SMIL keyframes, so it animates inside a plain <img> on GitHub with no JS.
// Depth is faked properly: every planet exists twice, a "back" copy under the
// sun and a "front" copy over it, swapped on discrete keyframes when the planet
// crosses the sun's plane. Moons do the same trick around their planet.

const W = 900;
const H = 480;
const CX = W / 2;
const CY = 238;
const FRAMES = 90; // keyframes per orbit
const CAMERA = (20 * Math.PI) / 180; // elevation
const FOCAL = 2000; // perspective distance
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const ROLLS = [-6, 5, -3, 7, -8, 4, -5, 6];
const INNER = 118; // first orbit radius, clear of the sun
const OUTER = 360; // last orbit radius, keeps labels inside the frame
const BELT_AFTER = 4; // the asteroid belt sits after this many planets
const BELT_GAP = 36;
const BELT_DUR = 240;
const BELT_ROLL = 2;
const AVATAR_R = 38;

const THEMES = {
  dark: {
    bgFrom: "#070a18",
    bgTo: "#0d1117",
    border: "#ffffff1a",
    text: "#e6edf3",
    muted: "#8b949e",
    orbit: "#7aa2ff",
    orbitOpacity: 0.22,
    star: "#ffffff",
    starOpacity: 0.85,
    sun: ["#fff6c2", "#ffc233", "#ff6a1a"],
    sunText: "#3a1500",
    glow: "#ffb347",
    labelShadow: "#000000",
    moonIssue: "#c9d1d9",
    moonRelease: "#ffd166",
    dust: "#c9d1d9",
    comet: "#d6ecff",
    dish: "#dfe6ee",
    signal: "#7ee787",
    hull: "#dfe6ee",
    hullEdge: "#8b949e",
    fin: "#ff7b72",
    flame: "#ffb347",
    cockpit: "#79c0ff",
    ciOk: "#3fb950",
    ciFail: "#f85149",
    ciRun: "#d29922",
    panel: "#388bfd",
    rock: "#5c4033",
    lava: "#ff7b00",
    smoke: "#c9d1d9",
    crater: "#30363d",
    craterEdge: "#8b949e",
    link: "#79c0ff",
    graph: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  },
  light: {
    bgFrom: "#f7f9ff",
    bgTo: "#e7edfb",
    border: "#00000014",
    text: "#1f2328",
    muted: "#59636e",
    orbit: "#4f6bd0",
    orbitOpacity: 0.28,
    star: "#8fa6f2",
    starOpacity: 0.7,
    sun: ["#fff6c2", "#ffc233", "#ff6a1a"],
    sunText: "#3a1500",
    glow: "#ffb347",
    labelShadow: "#ffffff",
    moonIssue: "#6e7781",
    moonRelease: "#d99a00",
    dust: "#59636e",
    comet: "#2f6fdb",
    dish: "#59636e",
    signal: "#1a7f37",
    hull: "#ffffff",
    hullEdge: "#59636e",
    fin: "#cf222e",
    flame: "#fb8500",
    cockpit: "#0969da",
    ciOk: "#1a7f37",
    ciFail: "#cf222e",
    ciRun: "#9a6700",
    panel: "#0969da",
    rock: "#7a5240",
    lava: "#e85d04",
    smoke: "#8c959f",
    crater: "#57606a",
    craterEdge: "#d0d7de",
    link: "#0969da",
    graph: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  },
};

// GitHub's linguist colours. The build fetches the full, current list; these
// are only the fallback for when that fails.
export const LANG_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  HTML: "#e34c26",
  CSS: "#663399",
  SCSS: "#c6538c",
  Shell: "#89e051",
  Rust: "#dea584",
  Go: "#00ADD8",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Lua: "#000080",
  PHP: "#4F5D95",
  Ruby: "#701516",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Astro: "#ff5a03",
  Dart: "#00B4AB",
  Swift: "#F05138",
  Dockerfile: "#384d54",
  "Jupyter Notebook": "#DA5B0B",
  Nix: "#7e7eff",
  Makefile: "#427819",
  PowerShell: "#012456",
  Zig: "#ec915c",
  MDX: "#fcb32c",
  EJS: "#a91e50",
};
const NO_LANG = "#8b949e";

// ---------- small helpers ----------
const esc = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const deg = (d) => (d * Math.PI) / 180;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const loop = (dur) => `dur="${dur}s" repeatCount="indefinite"`;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(hex, target, amount) {
  const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const t = target === "white" ? 255 : 0;
  const out = [0, 1, 2].map((i) => Math.round(p(hex, i) + (t - p(hex, i)) * amount));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Mostly grey, with a hint of the original colour left.
function greyed(hex) {
  const p = (i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const lum = Math.round(0.3 * p(0) + 0.59 * p(1) + 0.11 * p(2));
  const g = Math.max(90, Math.min(150, lum));
  const out = [0, 1, 2].map((i) => Math.round(g + (p(i) - g) * 0.25));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function langColor(language, colors = {}) {
  const c = (language && (colors[language] ?? LANG_COLORS[language])) || NO_LANG;
  return /^#[0-9a-f]{6}$/i.test(c) ? c : NO_LANG;
}

// Long names wrap after a "-", so no line gets longer than LABEL_MAX characters
// (the trailing "-" doesn't count). A single part that's longer stays whole.
const LABEL_MAX = "everythingyouneed".length;

export function labelLines(name) {
  const parts = name.split("-");
  const lines = [];
  let line = "";
  parts.forEach((part, i) => {
    const piece = i < parts.length - 1 ? part + "-" : part;
    const next = line + part;
    if (line && next.length > LABEL_MAX) {
      lines.push(line);
      line = piece;
    } else {
      line += piece;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function planetRadius(repo) {
  const r = 6.5 + 3.2 * Math.log2(1 + repo.stars) + 2.2 * Math.log10(1 + repo.size);
  return Math.max(7.5, Math.min(21, r));
}

// ---------- the 3D bit ----------
function project(R, theta, rollRad) {
  // point on a flat orbit, then roll the plane, then tilt the camera
  const x0 = R * Math.cos(theta);
  const z0 = R * Math.sin(theta);
  const x1 = x0 * Math.cos(rollRad);
  const y1 = x0 * Math.sin(rollRad);
  const y2 = y1 * Math.cos(CAMERA) + z0 * Math.sin(CAMERA);
  const z2 = -y1 * Math.sin(CAMERA) + z0 * Math.cos(CAMERA);
  const s = FOCAL / (FOCAL - z2);
  return { x: CX + x1 * s, y: CY + y2 * s, z: z2, s };
}

// Orbit radii, with room for the asteroid belt after the first few planets.
function layout(n, hasBelt) {
  const split = hasBelt ? Math.min(BELT_AFTER, n) : n;
  const gap = hasBelt && split < n ? BELT_GAP : 0;
  const step = n > 1 ? Math.min(44, (OUTER - INNER - gap) / (n - 1)) : 32;
  const radii = Array.from({ length: n }, (_, i) => INNER + step * i + (i >= split ? gap : 0));
  let beltR = null;
  if (hasBelt) beltR = split < n ? INNER + step * (split - 1) + (step + gap) / 2 : n ? radii[n - 1] + 40 : INNER;
  return { radii, beltR };
}

function orbitPaths(R, rollRad) {
  const back = [];
  const front = [];
  const N = 160;
  let lastBack = null;
  let lastFront = null;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(project(R, (i / N) * Math.PI * 2, rollRad));
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const isFront = p.z >= 0;
    const list = isFront ? front : back;
    const last = isFront ? lastFront : lastBack;
    if (last !== i) list.push(`M${r1(p.x)} ${r1(p.y)}`);
    list.push(`L${r1(q.x)} ${r1(q.y)}`);
    if (isFront) lastFront = i + 1;
    else lastBack = i + 1;
  }
  return { back: back.join(""), front: front.join("") };
}

// ---------- pieces ----------
function starfield(theme, seed) {
  const rnd = mulberry32(seed);
  let out = "";
  for (let i = 0; i < 90; i++) {
    const x = r1(rnd() * W);
    const y = r1(rnd() * H);
    const r = r2(0.4 + rnd() * 0.9);
    const base = r2(0.25 + rnd() * 0.6);
    const dur = r1(2 + rnd() * 5);
    const begin = -r1(rnd() * 6);
    out +=
      `<circle cx="${x}" cy="${y}" r="${r}" fill="${theme.star}" opacity="${base}">` +
      `<animate attributeName="opacity" values="${base};${r2(base * 0.25)};${base}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
  }
  return `<g opacity="${theme.starOpacity}">${out}</g>`;
}

// Solar flares: loops of fire bursting off the sun on busy days.
function flares(theme) {
  const one = (angle, begin) => {
    const a1 = deg(angle - 16);
    const a2 = deg(angle + 16);
    const am = deg(angle);
    const p1 = [46 * Math.cos(a1), 46 * Math.sin(a1)];
    const p2 = [46 * Math.cos(a2), 46 * Math.sin(a2)];
    const c = [92 * Math.cos(am), 92 * Math.sin(am)];
    const d = `M${r1(p1[0])} ${r1(p1[1])} Q${r1(c[0])} ${r1(c[1])} ${r1(p2[0])} ${r1(p2[1])}`;
    const t = `dur="7s" begin="${begin}s" repeatCount="indefinite"`;
    const anim =
      `<animate attributeName="stroke-dashoffset" values="100;0;0;-100" keyTimes="0;0.2;0.4;0.6" ${t}/>` +
      `<animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.05;0.4;0.6;1" ${t}/>`;
    return (
      `<path d="${d}" pathLength="100" fill="none" stroke="${theme.glow}" stroke-width="7" stroke-opacity="0.35" stroke-linecap="round" stroke-dasharray="100 100" stroke-dashoffset="100" opacity="0">${anim}</path>` +
      `<path d="${d}" pathLength="100" fill="none" stroke="url(#flare)" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="100 100" stroke-dashoffset="100" opacity="0">${anim}</path>`
    );
  };
  return `<g class="flare">${one(-55, 0.5)}${one(160, 4)}${one(70, 2.3)}</g>`;
}

function sun(theme, login, avatar, flare) {
  const [c0, c1, c2] = theme.sun;
  const face = avatar
    ? `<image href="${avatar}" x="${-AVATAR_R}" y="${-AVATAR_R}" width="${AVATAR_R * 2}" height="${AVATAR_R * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatar-clip)"/>` +
      `<circle r="${AVATAR_R}" fill="url(#sun-tint)"/>` +
      `<circle r="${AVATAR_R}" fill="none" stroke="${c0}" stroke-opacity="0.9" stroke-width="1.5"/>`
    : `<text y="5" text-anchor="middle" font-family="${MONO}" font-size="14" font-weight="700" fill="${theme.sunText}">${esc(login)}</text>`;
  return `
  <circle cx="${CX}" cy="${CY}" r="130" fill="url(#sun-glow)"/>
  <g transform="translate(${CX} ${CY})">
    <circle r="64" fill="none" stroke="${c1}" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="2 7" stroke-linecap="round">
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" ${loop(40)}/>
    </circle>
    <circle r="72" fill="none" stroke="${c2}" stroke-opacity="0.3" stroke-width="1" stroke-dasharray="14 18">
      <animateTransform attributeName="transform" type="rotate" from="360" to="0" ${loop(70)}/>
    </circle>
    ${flare ? flares(theme) : ""}
    <circle r="46" fill="url(#sun-core)">
      <animate attributeName="r" values="45;47.5;45" ${loop(5)}/>
    </circle>
    ${face}
  </g>`;
}

// Moons circle their planet: gold for releases, grey for open issues and PRs.
function moons(repo, r, theme) {
  const releases = Math.min(2, repo.releases ?? 0);
  const issues = Math.min(4 - releases, repo.openIssues ?? 0);
  const kinds = [...Array(releases).fill("release"), ...Array(issues).fill("issue")];
  let back = "";
  let front = "";
  const N = 24;
  kinds.forEach((kind, k) => {
    const mr = r + 6 + k * 4.5;
    const dur = r1(5 + k * 1.8);
    const phase = ((hash(repo.name + k) % 360) / 360) * Math.PI * 2;
    const pos = [];
    const backOp = [];
    const frontOp = [];
    for (let j = 0; j <= N; j++) {
      const a = phase + (j / N) * Math.PI * 2;
      pos.push(`${r1(mr * Math.cos(a))} ${r1(mr * Math.sin(a) * 0.38)}`);
      if (j < N) {
        const isFront = Math.sin(a) > 0;
        backOp.push(isFront ? "0" : "0.8");
        frontOp.push(isFront ? "1" : "0");
      }
    }
    const fill = kind === "release" ? theme.moonRelease : theme.moonIssue;
    const size = kind === "release" ? 2.6 : 2.1;
    const mk = (ops) =>
      `<g class="moon" transform="translate(${pos[0]})" opacity="${ops[0]}">` +
      `<animateTransform attributeName="transform" type="translate" values="${pos.join(";")}" ${loop(dur)}/>` +
      `<animate attributeName="opacity" calcMode="discrete" values="${ops.join(";")}" ${loop(dur)}/>` +
      `<circle r="${size}" fill="${fill}"/></g>`;
    back += mk(backOp);
    front += mk(frontOp);
  });
  return { back, front };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // ~137.5°

// Where a planet is at any moment. Start angles step by the golden angle (with a
// little jitter), so planets begin spread around the sun instead of bunched up.
function orbitOf(repo, i, R, dur, phase) {
  const roll = deg(ROLLS[i % ROLLS.length]);
  const jitter = ((hash(repo.name) % 1000) / 1000 - 0.5) * 0.5;
  const theta0 = phase ?? i * GOLDEN + jitter;
  const at = (t) => project(R, theta0 + ((((t % dur) + dur) % dur) / dur) * Math.PI * 2, roll);
  return { R, roll, theta0, dur, at };
}

function planet(repo, i, orbit, theme) {
  const { R, roll, theta0, dur } = orbit;

  const translate = [];
  const scale = [];
  const light = []; // direction pointing away from the sun, so the night side faces out
  const shade = []; // how much night side we see: more when the planet is in front of the sun
  const backOpacity = [];
  const frontOpacity = [];
  let prev = null;
  for (let k = 0; k <= FRAMES; k++) {
    const p = project(R, theta0 + (k / FRAMES) * Math.PI * 2, roll);
    translate.push(`${r1(p.x)} ${r1(p.y)}`);
    scale.push(r2(p.s));
    let a = (Math.atan2(p.y - CY, p.x - CX) * 180) / Math.PI;
    if (prev !== null) {
      while (a - prev > 180) a -= 360;
      while (a - prev < -180) a += 360;
    }
    prev = a;
    light.push(r1(a));
    shade.push(r2(Math.max(0.08, Math.min(1, 0.55 + 0.45 * (p.z / R)))));
    if (k < FRAMES) {
      backOpacity.push(p.z < 0 ? "0.75" : "0");
      frontOpacity.push(p.z < 0 ? "0" : "1");
    }
  }

  const r = r1(planetRadius(repo));
  const m = moons(repo, r, theme);
  const sat = satellite(repo, r, theme);
  const body =
    `<circle r="${r1(r * 2.1)}" fill="url(#glow-${i})"/>` +
    m.back +
    sat.back +
    `<circle r="${r}" fill="url(#pl-${i})"/>` +
    (repo.abandoned ? craters(repo, r, theme) : "") +
    (repo.image ? `<use href="#tex-${i}" clip-path="url(#tex-clip-${i})"${repo.abandoned ? ' opacity="0.55"' : ""}/>` : "") +
    `<circle r="${r}" fill="none" stroke="url(#rim-${i})" stroke-width="0.8"/>` +
    `<g transform="rotate(${light[0]})">` +
    `<animateTransform attributeName="transform" type="rotate" values="${light.join(";")}" ${loop(dur)}/>` +
    `<circle r="${r}" fill="url(#shade)" opacity="${shade[0]}"><animate attributeName="opacity" values="${shade.join(";")}" ${loop(dur)}/></circle>` +
    `<circle cx="${r1(-r * 0.38)}" r="${r1(r * 0.55)}" fill="url(#spec)"/>` +
    `</g>` +
    (repo.active ? volcano(repo, r, theme) : "") +
    (repo.flagTag ? flag(repo, r, theme) : "") +
    (repo.pages ? dish(repo, r, theme) : "") +
    m.front +
    sat.front +
    `<text y="${r1(r + 14)}" text-anchor="middle" font-family="${MONO}" font-size="11" fill="${repo.abandoned ? theme.muted : theme.text}" stroke="${theme.labelShadow}" stroke-opacity="0.55" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${labelLines(repo.name)
      .map((line, n) => `<tspan x="0" dy="${n ? 12 : 0}">${esc(line)}</tspan>`)
      .join("")}</text>`;

  const anim =
    `<animateTransform attributeName="transform" type="translate" values="${translate.join(";")}" ${loop(dur)}/>` +
    `<animateTransform attributeName="transform" type="scale" additive="sum" values="${scale.join(";")}" ${loop(dur)}/>`;
  const op = (vals) => `<animate attributeName="opacity" calcMode="discrete" values="${vals.join(";")}" ${loop(dur)}/>`;

  // start at frame 0's position and opacity so renderers without SMIL still show the planets
  const mk = (cls, opacityVals) =>
    `<g class="${cls}" data-repo="${esc(repo.name)}" transform="translate(${translate[0]}) scale(${scale[0]})" opacity="${opacityVals[0]}">${anim}${op(opacityVals)}${body}</g>`;
  return { back: mk("pl-back", backOpacity), front: mk("pl-front", frontOpacity) };
}

// Dish and flag share one loop per planet and take turns: the dish is up for the
// first half, the flag for the second, and they overlap for a moment in between.
const PROPS_DUR = 20;
const DISH_TIMES = "0;0.02;0.07;0.5;0.55;1";
const FLAG_TIMES = "0;0.43;0.48;0.93;0.98;1";
const propsBegin = (repo) => -r1((hash(repo.name + "props") % (PROPS_DUR * 100)) / 100);

// Repos with a GitHub Pages site get a dish that now and then unfolds, sweeps
// the sky while beaming signals, and folds away again.
function dish(repo, r, theme) {
  const loopAt = `dur="${PROPS_DUR}s" begin="${propsBegin(repo)}s" repeatCount="indefinite"`;
  const wave = (offset) =>
    `<path d="M-3 -1.5 Q0 -4 3 -1.5" fill="none" stroke="${theme.signal}" stroke-width="0.9" stroke-linecap="round" opacity="0">` +
    `<animateTransform attributeName="transform" type="scale" values="0.8;3.4" dur="1.6s" begin="${offset}s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0.95;0" dur="1.6s" begin="${offset}s" repeatCount="indefinite"/></path>`;
  return (
    `<g class="dish" transform="translate(0 ${r1(-r + 1.5)})">` +
    `<g transform="scale(0)"><animateTransform attributeName="transform" type="scale" values="0;0;1;1;0;0" keyTimes="${DISH_TIMES}" ${loopAt}/>` +
    `<path d="M0 0 L0 -4.5" stroke="${theme.dish}" stroke-width="1.3" stroke-linecap="round"/>` +
    `<g transform="translate(0 -4.5)"><animateTransform attributeName="transform" type="rotate" values="-35;35;-35" dur="4.5s" repeatCount="indefinite" additive="sum"/>` +
    `<path d="M-5.5 -4 Q0 2.5 5.5 -4 Z" fill="${theme.dish}"/>` +
    `<path d="M0 -0.5 L0 -5" stroke="${theme.dish}" stroke-width="0.8"/>` +
    `<circle cy="-5.3" r="1.1" fill="${theme.signal}"/>` +
    `<g transform="translate(0 -5.5)">${wave(0)}${wave(0.55)}${wave(1.1)}</g>` +
    `</g></g></g>`
  );
}

// Untouched for half a year: the planet goes grey and gets craters.
function craters(repo, r, theme) {
  const rnd = mulberry32(hash(repo.name + "craters"));
  let out = "";
  for (let k = 0; k < 5; k++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * r * 0.65;
    const cr = r * (0.1 + rnd() * 0.14);
    out += `<circle cx="${r1(Math.cos(a) * d)}" cy="${r1(Math.sin(a) * d)}" r="${r1(cr)}" fill="${theme.crater}" fill-opacity="0.45" stroke="${theme.craterEdge}" stroke-opacity="0.35" stroke-width="0.6"/>`;
  }
  return out;
}

// A release in the last week (or a custom version, see fetch.mjs) plants a little
// flag on the planet. It's raised now and then, and lowered again.
function flag(repo, r, theme) {
  const raw = repo.flagTag;
  const tag = raw.length > 10 ? raw.slice(0, 9) + "…" : raw;
  const a = deg(-48);
  const x = r1(Math.cos(a) * r * 0.9);
  const y = r1(Math.sin(a) * r * 0.9);
  const w = r1(tag.length * 4.4 + 5);

  return (
    `<g class="flag" transform="translate(${x} ${y})"><g transform="scale(0)">` +
    `<animateTransform attributeName="transform" type="scale" values="0;0;1;1;0;0" keyTimes="${FLAG_TIMES}" dur="${PROPS_DUR}s" begin="${propsBegin(repo)}s" repeatCount="indefinite"/>` +
    `<path d="M0 0 L0 -15" stroke="${theme.dish}" stroke-width="0.9"/>` +
    `<g transform="translate(0 -15)"><animateTransform attributeName="transform" type="skewY" values="0;-7;0;5;0" dur="1.8s" repeatCount="indefinite" additive="sum"/>` +
    `<rect width="${w}" height="8" rx="1" fill="${theme.moonRelease}"/>` +
    `<text x="${r1(w / 2)}" y="6" text-anchor="middle" font-family="${MONO}" font-size="6.5" font-weight="700" fill="${theme.sunText}">${esc(tag)}</text>` +
    `</g></g></g>`
  );
}

// Pushed in the last 24 hours: the planet has an active volcano.
function volcano(repo, r, theme) {
  const a = -140;
  const x = r1(Math.cos(deg(a)) * r * 0.82);
  const y = r1(Math.sin(deg(a)) * r * 0.82);
  const puff = (i) =>
    `<circle cy="-4.5" r="1.4" fill="${theme.smoke}" opacity="0">` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;-3 -13" dur="2.7s" begin="${i * 0.9}s" repeatCount="indefinite"/>` +
    `<animate attributeName="r" values="1.4;4.2" dur="2.7s" begin="${i * 0.9}s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0.85;0" dur="2.7s" begin="${i * 0.9}s" repeatCount="indefinite"/></circle>`;
  return (
    `<g class="volcano" transform="translate(${x} ${y}) rotate(${a + 90})">` +
    `${puff(0)}${puff(1)}${puff(2)}` +
    `<path d="M-4.5 1.5 L-1.3 -4 L1.3 -4 L4.5 1.5 Z" fill="${theme.rock}"/>` +
    `<ellipse cy="-4" rx="1.5" ry="0.8" fill="${theme.lava}"><animate attributeName="opacity" values="0.55;1;0.55" dur="0.9s" repeatCount="indefinite"/></ellipse>` +
    `</g>`
  );
}

// A satellite orbits planets with GitHub Actions; its light shows the latest run:
// green passed, red failed (blinking faster), amber still running.
function satellite(repo, r, theme) {
  if (!repo.ci) return { back: "", front: "" };
  const color = { success: theme.ciOk, failure: theme.ciFail, running: theme.ciRun }[repo.ci] ?? theme.muted;
  const blink = repo.ci === "failure" ? 0.6 : 1.4;
  const sr = r + 9;
  const tilt = deg(28);
  const dur = 9;
  const phase = ((hash(repo.name + "sat") % 360) / 360) * Math.PI * 2;
  const N = 30;
  const pos = [];
  const backOp = [];
  const frontOp = [];
  for (let j = 0; j <= N; j++) {
    const a = phase - (j / N) * Math.PI * 2; // opposite direction to the moons
    const x = sr * Math.cos(a);
    const y = sr * Math.sin(a) * 0.55;
    pos.push(`${r1(x * Math.cos(tilt) - y * Math.sin(tilt))} ${r1(x * Math.sin(tilt) + y * Math.cos(tilt))}`);
    if (j < N) {
      const isFront = Math.sin(a) > 0;
      backOp.push(isFront ? "0" : "0.85");
      frontOp.push(isFront ? "1" : "0");
    }
  }
  const mk = (ops) =>
    `<g class="satellite" transform="translate(${pos[0]})" opacity="${ops[0]}">` +
    `<animateTransform attributeName="transform" type="translate" values="${pos.join(";")}" ${loop(dur)}/>` +
    `<animate attributeName="opacity" calcMode="discrete" values="${ops.join(";")}" ${loop(dur)}/>` +
    `<rect x="-6.5" y="-0.9" width="4" height="1.8" fill="${theme.panel}"/><rect x="2.5" y="-0.9" width="4" height="1.8" fill="${theme.panel}"/>` +
    `<rect x="-1.6" y="-1.6" width="3.2" height="3.2" rx="0.6" fill="${theme.hull}" stroke="${theme.hullEdge}" stroke-width="0.4"/>` +
    `<circle cy="-2.8" r="1.2" fill="${color}"><animate attributeName="opacity" values="1;0.15;1" dur="${blink}s" repeatCount="indefinite"/></circle></g>`;
  return { back: mk(backOp), front: mk(frontOp) };
}

// Every repo that didn't get a planet is an asteroid, in its language colour,
// drifting through a ring of dust.
function asteroidBelt(repos, R, theme, colors, seed) {
  if (!repos.length || R == null) return "";
  const rnd = mulberry32(seed);
  const roll = deg(BELT_ROLL);

  let dust = "";
  for (let i = 0; i < 80; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = R + (rnd() - 0.5) * 22;
    dust += `<circle cx="${r1(rr * Math.cos(a))}" cy="${r1(rr * Math.sin(a))}" r="${r2(0.6 + rnd() * 0.8)}" fill="${theme.dust}" opacity="${r2(0.15 + rnd() * 0.35)}"/>`;
  }
  const dustLayer =
    `<g transform="translate(${CX} ${CY}) rotate(${BELT_ROLL}) scale(1 ${r2(Math.sin(CAMERA))})"><g>` +
    `<animateTransform attributeName="transform" type="rotate" from="0" to="360" ${loop(BELT_DUR)}/>${dust}</g></g>`;

  const rocks = repos
    .map((repo) => {
      const rr = R + (rnd() - 0.5) * 16;
      const t0 = ((hash(repo.name) % 3600) / 3600) * Math.PI * 2;
      const pos = [];
      for (let f = 0; f <= 60; f++) {
        const p = project(rr, t0 + (f / 60) * Math.PI * 2, roll);
        pos.push(`${r1(p.x)} ${r1(p.y)}`);
      }
      const size = r1(Math.min(3.4, 1.6 + 0.4 * Math.log10(1 + repo.size) + 0.5 * Math.log2(1 + repo.stars)));
      return (
        `<g class="asteroid" data-repo="${esc(repo.name)}" transform="translate(${pos[0]})">` +
        `<animateTransform attributeName="transform" type="translate" values="${pos.join(";")}" ${loop(BELT_DUR)}/>` +
        `<circle r="${size}" fill="${langColor(repo.language, colors)}"/></g>`
      );
    })
    .join("");

  return dustLayer + rocks;
}

// Contributors visit by spaceship: avatar in the cockpit, @username above it.
// A ship flies in, lands on its planet, stays a moment, lifts off and leaves by
// another edge. Its loop lasts a whole number of that planet's orbits, so every
// visit lines up, and the whole stay happens while the planet is in front of the
// sun and off to the side.
const SHIP_FLIGHT = 7;
const SHIP_DOCK = 1.2;
const SHIP_STAY = 3;
const SHIP_EVERY = 40; // seconds, roughly, between visits of one ship

function edgePoint(h) {
  const side = h % 3;
  const along = ((h >>> 8) % 1000) / 1000;
  if (side === 0) return { side, x: -40, y: 70 + along * (H - 180) };
  if (side === 1) return { side, x: W + 40, y: 70 + along * (H - 180) };
  return { side, x: 120 + along * (W - 240), y: -40 };
}

// Several contributors of one planet take turns: each gets their own window of
// D0 seconds inside a shared loop of D0 * turns, so every visit is someone else.
function ship(s, k, orbit, theme) {
  const turn = s.turn ?? 0;
  const turns = s.turns ?? 1;
  k = turn;
  const ground = 2 * SHIP_DOCK + SHIP_STAY;

  let tz = 0;
  let best = -Infinity;
  for (let j = 0; j < 180; j++) {
    const t = (j / 180) * orbit.dur;
    let ok = true;
    for (let u = 0; u <= 6; u++) if (orbit.at(t + (u / 6) * ground).z < 0.15 * orbit.R) ok = false;
    const score = ok ? Math.abs(orbit.at(t).x - CX) + Math.abs(orbit.at(t + ground).x - CX) : -1;
    if (score > best) [best, tz] = [score, t];
  }

  let m = Math.max(1, Math.ceil(SHIP_EVERY / orbit.dur));
  let slots = [];
  for (; slots.length === 0; m++) {
    const D = orbit.dur * m;
    for (let j = 0; j < m; j++) {
      const ta = tz + j * orbit.dur;
      if (ta - SHIP_FLIGHT >= 0.5 && ta + ground + SHIP_FLIGHT <= D - 0.5) slots.push(ta);
    }
    if (slots.length) break;
  }
  const D0 = orbit.dur * m;
  const D = D0 * turns;
  const ta = slots[0] + turn * D0;
  const t0 = ta - SHIP_FLIGHT;
  const tl = ta + SHIP_DOCK + SHIP_STAY; // lift-off
  const tGone = tl + SHIP_DOCK + SHIP_FLIGHT;

  const h = hash(s.login + k);
  const start = edgePoint(h);
  let end = edgePoint(hash(s.login + "away" + k));
  for (let n = 1; end.side === start.side; n++) end = edgePoint(hash(s.login + "away" + k + n));

  const keys = [];
  const add = (t, x, y, sc, kind) => keys.push({ t, x, y, sc, kind });
  const ease = (u) => u * u * (3 - 2 * u);
  add(0, start.x, start.y, 1, "in");
  add(t0, start.x, start.y, 1, "in");
  for (let j = 1; j <= 24; j++) {
    const u = j / 24;
    const p = orbit.at(t0 + u * SHIP_FLIGHT);
    add(t0 + u * SHIP_FLIGHT, start.x + (p.x - start.x) * ease(u), start.y + (p.y - start.y) * ease(u), 1, "in");
  }
  for (let j = 1; j <= 5; j++) {
    const t = ta + (j / 5) * SHIP_DOCK;
    const p = orbit.at(t);
    add(t, p.x, p.y, r2(Math.max(0.01, 1 - j / 5)), "land");
  }
  for (let j = 1; j <= 4; j++) {
    const t = ta + SHIP_DOCK + (j / 4) * SHIP_STAY;
    const p = orbit.at(t);
    add(t, p.x, p.y, 0.01, "land");
  }
  for (let j = 1; j <= 5; j++) {
    const t = tl + (j / 5) * SHIP_DOCK;
    const p = orbit.at(t);
    add(t, p.x, p.y, r2(Math.max(0.01, j / 5)), "lift");
  }
  const t1 = tl + SHIP_DOCK;
  for (let j = 1; j <= 24; j++) {
    const u = j / 24;
    const p = orbit.at(t1 + u * SHIP_FLIGHT);
    const e = u * u; // ease out of the planet's pull
    add(t1 + u * SHIP_FLIGHT, p.x + (end.x - p.x) * e, p.y + (end.y - p.y) * e, 1, "out");
  }
  add(D, end.x, end.y, 1, "out");

  // hull heading: follow the path in flight, hold it while landed or lifting off
  const raw = keys.map((kf, j) => {
    const nb = keys[Math.min(j + 1, keys.length - 1)];
    const pv = keys[Math.max(j - 1, 0)];
    return (Math.atan2(nb.y - pv.y, nb.x - pv.x) * 180) / Math.PI;
  });
  const firstIn = keys.findIndex((kf) => kf.kind === "in" && kf.t > t0) + 1;
  const lastIn = keys.findLastIndex((kf) => kf.kind === "in");
  const firstOut = keys.findIndex((kf) => kf.kind === "out") + 1;
  keys.forEach((kf, j) => {
    if (kf.kind === "in" && j < firstIn) raw[j] = raw[firstIn];
    if (kf.kind === "land") raw[j] = raw[lastIn - 1];
    if (kf.kind === "lift") raw[j] = raw[firstOut];
    if (kf.kind === "out" && j >= keys.length - 2) raw[j] = raw[keys.length - 3];
  });
  const heading = [];
  let prev = null;
  for (let a of raw) {
    if (prev !== null) {
      while (a - prev > 180) a -= 360;
      while (a - prev < -180) a += 360;
    }
    prev = a;
    heading.push(r1(a));
  }

  const kt = keys.map((kf) => (kf.t / D).toFixed(4));
  kt[0] = "0";
  kt[kt.length - 1] = "1";
  const timing = `keyTimes="${kt.join(";")}" dur="${r1(D)}s" repeatCount="indefinite"`;
  const pos = keys.map((kf) => `${r1(kf.x)} ${r1(kf.y)}`).join(";");
  const sc = keys.map((kf) => kf.sc).join(";");
  const f = (t) => (t / D).toFixed(4);
  const fade = `values="0;0;1;1;0;0" keyTimes="0;${f(t0)};${f(t0 + 0.5)};${f(tGone - 0.5)};${f(tGone)};1" dur="${r1(D)}s" repeatCount="indefinite"`;

  const pilot = s.pilotId != null
    ? `<use href="#pilot-${s.pilotId}" clip-path="url(#pilot-clip)"/>`
    : `<text y="3.5" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="700" fill="${theme.text}">${esc(s.login[0]?.toUpperCase() ?? "?")}</text>`;

  return `<g class="ship" data-login="${esc(s.login)}" transform="translate(${r1(start.x)} ${r1(start.y)})" opacity="0">
    <animateTransform attributeName="transform" type="translate" values="${pos}" ${timing}/>
    <animateTransform attributeName="transform" type="scale" additive="sum" values="${sc}" ${timing}/>
    <animate attributeName="opacity" ${fade}/>
    <g transform="rotate(${heading[0]})">
      <animateTransform attributeName="transform" type="rotate" values="${heading.join(";")}" ${timing}/>
      <path d="M-13 -3.5 L-22 0 L-13 3.5 Z" fill="${theme.flame}"><animate attributeName="opacity" values="1;0.35;1" dur="0.3s" repeatCount="indefinite"/></path>
      <path d="M-7 -7 L-15 -13 L-2 -7 Z M-7 7 L-15 13 L-2 7 Z" fill="${theme.fin}"/>
      <path d="M-13 -7 L6 -7 Q15 -6 18 0 Q15 6 6 7 L-13 7 Q-10 0 -13 -7 Z" fill="${theme.hull}" stroke="${theme.hullEdge}" stroke-width="0.8"/>
    </g>
    <circle r="9.5" fill="${theme.bgTo}" stroke="${theme.cockpit}" stroke-width="1.5"/>
    ${pilot}
    <text y="-15" text-anchor="middle" font-family="${MONO}" font-size="9.5" fill="${theme.text}" stroke="${theme.labelShadow}" stroke-opacity="0.55" stroke-width="3" paint-order="stroke" stroke-linejoin="round">@${esc(s.login)}</text>
  </g>`;
}

// A star someone gave this week falls as a shooting star, then their name
// lingers where it burned out.
function shootingStars(list, theme) {
  const D = 30;
  return list
    .slice(0, 3)
    .map((st, k) => {
      const h = hash(st.login + st.repo);
      const x0 = 300 + (h % 380);
      const y0 = 30 + ((h >>> 9) % 50);
      const [x1, y1] = [x0 - 160, y0 + 110];
      const begin = 6 + k * 10;
      const label = `★ @${st.login} starred ${st.repo}`;
      const T = (s) => (s / D).toFixed(4);
      const loopAt = `dur="${D}s" begin="${begin}s" repeatCount="indefinite"`;
      return `<g class="shooting-star">
    <g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;${T(0.1)};${T(0.8)};${T(1.1)};1" ${loopAt}/>
      <g transform="translate(${x0} ${y0})">
        <animateTransform attributeName="transform" type="translate" values="${x0} ${y0};${x1} ${y1};${x1} ${y1}" keyTimes="0;${T(1)};1" ${loopAt}/>
        <g transform="rotate(${r1((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI)})">
          <ellipse cx="-34" rx="34" ry="1.3" fill="url(#comet-tail)"/>
          <circle r="5" fill="url(#comet-glow)"/>
          <circle r="1.8" fill="${theme.moonRelease}"/>
        </g>
      </g>
    </g>
    <text x="${x1}" y="${y1 + 16}" text-anchor="middle" font-family="${MONO}" font-size="10.5" fill="${theme.moonRelease}" stroke="${theme.labelShadow}" stroke-opacity="0.6" stroke-width="3" paint-order="stroke" stroke-linejoin="round" opacity="0">${esc(label)}<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${T(0.9)};${T(1.4)};${T(5)};${T(6)};1" ${loopAt}/></text>
  </g>`;
    })
    .join("\n  ");
}

// Orbit periods: inner planets (fresher pushes) move faster. A linked planet's
// period is nudged to a simple ratio of its partner's (like 5:4), so the pair
// lines up again after minutes instead of most of an hour, which keeps the
// beam's keyframes small.
const RATIOS = [];
for (let p = 1; p <= 12; p++) for (let q = 1; q <= 12; q++) if (gcd(p, q) === 1) RATIOS.push(p / q);

// Speeds differ only a little, so planets keep the spread they start with
// (golden-angle steps) instead of bunching up. A linked planet starts just
// behind its partner, so their beam shows soon after the page loads.
function periods(planets, links) {
  const base = planets.map((_, i) => 44 + i * 4);
  const durs = [...base];
  const phases = planets.map(() => undefined);
  const index = (name) => planets.findIndex((p) => p.name.toLowerCase() === String(name).toLowerCase());
  const adj = new Map();
  for (const [a, b] of links) {
    const [ia, ib] = [index(a), index(b)];
    if (ia < 0 || ib < 0 || ia === ib) continue;
    if (!adj.has(ia)) adj.set(ia, []);
    if (!adj.has(ib)) adj.set(ib, []);
    adj.get(ia).push(ib);
    adj.get(ib).push(ia);
  }
  // Each group of linked planets runs at tenths of its first planet's period
  // (1.1x, 1.2x, ...), so any two of them line up again within minutes. Linked
  // neighbours start a little apart, alternating sides.
  const seen = new Set();
  for (const root of [...adj.keys()].sort((x, y) => x - y)) {
    if (seen.has(root)) continue;
    seen.add(root);
    phases[root] = root * GOLDEN;
    const queue = [root];
    let side = 1;
    while (queue.length) {
      const u = queue.shift();
      for (const v of adj.get(u)) {
        if (seen.has(v)) continue;
        seen.add(v);
        durs[v] = (base[root] * Math.max(1, Math.round((10 * base[v]) / base[root]))) / 10;
        phases[v] = phases[u] + side * 1.4;
        side = -side;
        queue.push(v);
      }
    }
  }
  // everyone else takes the free spot furthest from the planets already placed
  const gap = (a, b) => {
    const d = Math.abs((((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    return Math.min(d, 2 * Math.PI - d);
  };
  planets.forEach((p, i) => {
    if (phases[i] !== undefined) return;
    const placed = phases.filter((x) => x !== undefined);
    if (!placed.length) {
      phases[i] = i * GOLDEN;
      return;
    }
    let best = 0;
    let bestGap = -1;
    for (let c = 0; c < 72; c++) {
      const cand = (c / 72) * 2 * Math.PI + ((hash(p.name) % 100) / 100) * 0.05;
      const g = Math.min(...placed.map((x) => gap(x, cand)));
      if (g > bestGap) [best, bestGap] = [cand, g];
    }
    phases[i] = best;
  });
  return { durs, phases };
}

function commonCycle(da, db) {
  for (let k = 1; k <= 60; k++) {
    const t = k * da;
    if (Math.abs(t / db - Math.round(t / db)) < 1e-6) return t;
  }
  return null;
}

// Repos that depend on each other (config "links") share an energy beam
// whenever their planets come near each other. The beam follows both planets
// over their combined cycle; keyframes are only dense while they're close.
const LINK_NEAR = 125;
const LINK_STEP = 2; // s; endpoints drift <2px from the true arc between keyframes

function linkBeams(pairs, planets, orbitsOf, theme) {
  const index = (name) => planets.findIndex((p) => p.name.toLowerCase() === String(name).toLowerCase());
  return pairs
    .map(([a, b]) => [index(a), index(b)])
    .filter(([ia, ib]) => ia >= 0 && ib >= 0 && ia !== ib)
    .map(([ia, ib]) => {
      const oa = orbitsOf[ia];
      const ob = orbitsOf[ib];
      const L = commonCycle(oa.dur, ob.dur);
      if (!L || L > 1200) return ""; // no short shared cycle, skip rather than bloat the SVG
      const samples = [];
      for (let t = 0; t <= L + 1e-9; t += LINK_STEP) {
        const p = oa.at(t);
        const q = ob.at(t);
        const dist = Math.hypot(p.x - q.x, p.y - q.y);
        const edge = t < LINK_STEP || t > L - LINK_STEP;
        const op = edge ? 0 : Math.max(0, Math.min(1, (LINK_NEAR - dist) / 30)) * 0.85;
        samples.push({ t: Math.min(t, L), p, q, op });
      }
      if (!samples.some((s) => s.op > 0)) return ""; // never close enough
      const keep = samples.filter((s, j) => j === 0 || j === samples.length - 1 || s.op > 0 || samples[j - 1].op > 0 || samples[j + 1]?.op > 0);
      const kt = keep.map((s) => (s.t / L).toFixed(5));
      kt[0] = "0";
      kt[kt.length - 1] = "1";
      const timing = `keyTimes="${kt.join(";")}" dur="${r1(L)}s" repeatCount="indefinite"`;
      const d = keep.map((s) => `M${r1(s.p.x)} ${r1(s.p.y)}L${r1(s.q.x)} ${r1(s.q.y)}`).join(";");
      const ops = keep.map((s) => r2(s.op)).join(";");
      const first = keep[0];
      const path = (extra) =>
        `<path d="M${r1(first.p.x)} ${r1(first.p.y)}L${r1(first.q.x)} ${r1(first.q.y)}" ${extra}><animate attributeName="d" values="${d}" ${timing}/></path>`;
      return (
        `<g class="link" data-link="${esc(planets[ia].name)}|${esc(planets[ib].name)}" opacity="0"><animate attributeName="opacity" values="${ops}" ${timing}/>` +
        path(`stroke="${theme.link}" stroke-width="5" stroke-opacity="0.18" stroke-linecap="round"`) +
        path(`stroke="${theme.link}" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="3 5"`).replace(
          "</path>",
          `<animate attributeName="stroke-dashoffset" values="0;-16" dur="0.8s" repeatCount="indefinite"/></path>`,
        ) +
        `</g>`
      );
    })
    .join("\n  ");
}

// Now and then the space station drifts across the bottom. Its two solar wings
// are the last two weeks of contributions, coloured like GitHub's graph.
function station(weeks, theme) {
  if (!weeks?.length) return "";
  const levels = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  const cell = 5.2;
  const step = 6.4;
  const wing = (days, x) =>
    Array.from({ length: 7 }, (_, d) => {
      const day = days[d];
      const y = r1(-3.5 * step + d * step);
      return day
        ? `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="1" fill="${theme.graph[levels[day.level] ?? 0]}"/>`
        : `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="1" fill="none" stroke="${theme.graph[0]}" stroke-width="0.6"/>`;
    }).join("");
  const [prev, cur] = weeks.length > 1 ? weeks.slice(-2) : [[], weeks[0]];
  const D = 52;
  const timing = `dur="${D}s" begin="16s" repeatCount="indefinite"`;
  const [x0, y0, x1, y1] = [W + 70, 404, -70, 378];
  return `<g class="station" opacity="0">
    <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.02;0.44;0.46;1" ${timing}/>
    <g transform="translate(${x0} ${y0})">
      <animateTransform attributeName="transform" type="translate" values="${x0} ${y0};${x1} ${y1};${x1} ${y1}" keyTimes="0;0.46;1" ${timing}/>
      <g><animateTransform attributeName="transform" type="rotate" values="-4;4;-4" dur="9s" repeatCount="indefinite"/>
        <path d="M-26 0 L26 0" stroke="${theme.hullEdge}" stroke-width="1.2"/>
        <rect x="-33" y="-24" width="${r1(cell + 2.4)}" height="${r1(7 * step + 1.6)}" rx="1.5" fill="${theme.bgTo}" stroke="${theme.hullEdge}" stroke-width="0.6"/>
        <rect x="${r1(33 - cell - 2.4)}" y="-24" width="${r1(cell + 2.4)}" height="${r1(7 * step + 1.6)}" rx="1.5" fill="${theme.bgTo}" stroke="${theme.hullEdge}" stroke-width="0.6"/>
        ${wing(prev, -31.8)}${wing(cur, r1(33 - cell - 1.2))}
        <rect x="-9" y="-8" width="18" height="16" rx="4" fill="${theme.hull}" stroke="${theme.hullEdge}" stroke-width="0.8"/>
        <rect x="-3" y="-13" width="6" height="5" rx="1" fill="${theme.hull}" stroke="${theme.hullEdge}" stroke-width="0.6"/>
        <circle cx="-3.5" cy="0" r="1.6" fill="${theme.cockpit}"/><circle cx="3.5" cy="0" r="1.6" fill="${theme.cockpit}"/>
        <circle cy="-14.5" r="1.1" fill="${theme.ciFail}"><animate attributeName="opacity" values="1;0.1;1" dur="1.6s" repeatCount="indefinite"/></circle>
      </g>
    </g>
  </g>`;
}

// Fireworks over the sun when a milestone was reached this week, with its label.
function fireworks(milestones, theme) {
  if (!milestones?.length) return "";
  const D = 26;
  const T = (t) => (t / D).toFixed(4);
  const colors = [theme.moonRelease, theme.fin, theme.cockpit, theme.signal, theme.lava];
  const burst = (x, y, color, start, seed) => {
    const rnd = mulberry32(seed);
    const rise = 0.7;
    const t = `dur="${D}s" begin="${r1(start)}s" repeatCount="indefinite"`;
    let sparks = "";
    for (let p = 0; p < 16; p++) {
      const a = (p / 16) * Math.PI * 2 + rnd() * 0.2;
      const dist = 30 + rnd() * 14;
      const [dx, dy] = [r1(Math.cos(a) * dist), r1(Math.sin(a) * dist)];
      sparks +=
        `<circle r="1.5" fill="${color}" opacity="0">` +
        `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;${dx} ${dy};${dx} ${r1(dy + 10)};${dx} ${r1(dy + 10)}" keyTimes="0;${T(rise)};${T(rise + 0.9)};${T(rise + 1.9)};1" ${t}/>` +
        `<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;${T(rise)};${T(rise + 0.1)};${T(rise + 1.9)};1" ${t}/></circle>`;
    }
    const rocket =
      `<circle r="1.4" fill="${color}" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="0 110;0 0;0 0" keyTimes="0;${T(rise)};1" ${t}/>` +
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.002;${T(rise)};1" ${t}/></circle>`;
    return `<g transform="translate(${x} ${y})">${rocket}${sparks}</g>`;
  };
  return milestones
    .slice(0, 3)
    .map((m, k) => {
      const begin = 9 + k * 9;
      const h = hash(m.label);
      const spots = [
        [CX - 150 + (h % 40), 112],
        [CX + 130 + ((h >>> 6) % 40), 98],
        [CX - 10 + ((h >>> 12) % 30), 78],
      ];
      const t = `dur="${D}s" begin="${begin}s" repeatCount="indefinite"`;
      return (
        `<g class="fireworks">` +
        spots.map(([x, y], j) => burst(x, y, colors[(k + j) % colors.length], begin + j * 0.55, h + j)).join("") +
        `<text x="${CX}" y="150" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="700" letter-spacing="1" fill="${theme.moonRelease}" stroke="${theme.labelShadow}" stroke-opacity="0.6" stroke-width="3" paint-order="stroke" stroke-linejoin="round" opacity="0">✦ ${esc(m.label)} ✦` +
        `<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${T(0.9)};${T(1.4)};${T(5.5)};${T(6.3)};1" ${t}/></text>` +
        `</g>`
      );
    })
    .join("\n  ");
}

// A comet streaks past now and then, trailing the latest commit message.
function comet(last, theme) {
  if (!last?.message) return "";
  const msg = last.message.length > 64 ? last.message.slice(0, 63) + "…" : last.message;
  const label = `${last.repo} · ${msg}`;
  const textW = label.length * 6.7;
  const [x0, y0] = [-40, 86];
  const [x1, y1] = [W + 40 + textW, 112];
  const angle = r1((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI);
  const timing = `dur="28s" begin="3s" repeatCount="indefinite"`;
  return `<g class="comet" opacity="0">
    <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.02;0.5;0.52;1" ${timing}/>
    <g transform="translate(${x0} ${y0})">
      <animateTransform attributeName="transform" type="translate" values="${x0} ${y0};${r1(x1)} ${y1};${r1(x1)} ${y1}" keyTimes="0;0.5;1" ${timing}/>
      <g transform="rotate(${angle})">
        <ellipse cx="-60" rx="60" ry="2.2" fill="url(#comet-tail)"/>
        <circle r="9" fill="url(#comet-glow)"/>
        <circle r="2.6" fill="${theme.comet}"/>
      </g>
      <text x="-24" y="18" text-anchor="end" font-family="${MONO}" font-size="11" fill="${theme.text}" stroke="${theme.labelShadow}" stroke-opacity="0.55" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${esc(label)}</text>
    </g>
  </g>`;
}

// A custom planet image (planets/<repo>.png) lives in <defs> once and is <use>d
// by both the back and front copy, so the embedded image isn't stored twice.
function texture(repo, i) {
  if (!repo.image) return "";
  const r = r1(planetRadius(repo) * 0.66); // a logo on the planet, not the whole planet
  return (
    `<clipPath id="tex-clip-${i}"><circle r="${r}"/></clipPath>` +
    `<image id="tex-${i}" href="${repo.image}" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice"/>`
  );
}

function defs(theme, planets, colors) {
  const [c0, c1, c2] = theme.sun;
  const grads = planets
    .map((repo, i) => {
      const c = repo.abandoned ? greyed(langColor(repo.language, colors)) : langColor(repo.language, colors);
      return (
        `<radialGradient id="pl-${i}" cx="0.5" cy="0.5" r="0.6">` +
        `<stop offset="0" stop-color="${mix(c, "white", 0.2)}"/>` +
        `<stop offset="0.6" stop-color="${c}"/>` +
        `<stop offset="1" stop-color="${mix(c, "black", 0.3)}"/></radialGradient>` +
        `<linearGradient id="rim-${i}"><stop offset="0" stop-color="${mix(c, "white", 0.5)}" stop-opacity="0.6"/><stop offset="1" stop-color="${mix(c, "white", 0.5)}" stop-opacity="0.15"/></linearGradient>` +
        `<radialGradient id="glow-${i}"><stop offset="0" stop-color="${c}" stop-opacity="0.35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>` +
        texture(repo, i)
      );
    })
    .join("");
  return `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${theme.bgFrom}"/><stop offset="1" stop-color="${theme.bgTo}"/></linearGradient>
  <radialGradient id="sun-core" cx="0.38" cy="0.32" r="0.85"><stop offset="0" stop-color="${c0}"/><stop offset="0.5" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>
  <radialGradient id="sun-glow"><stop offset="0" stop-color="${theme.glow}" stop-opacity="0.55"/><stop offset="0.45" stop-color="${theme.glow}" stop-opacity="0.12"/><stop offset="1" stop-color="${theme.glow}" stop-opacity="0"/></radialGradient>
  <radialGradient id="sun-tint"><stop offset="0.6" stop-color="${c1}" stop-opacity="0"/><stop offset="0.9" stop-color="${c1}" stop-opacity="0.35"/><stop offset="1" stop-color="${c2}" stop-opacity="0.7"/></radialGradient>
  <linearGradient id="flare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="0.5" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>
  <clipPath id="pilot-clip"><circle r="8"/></clipPath>
  <clipPath id="avatar-clip"><circle r="${AVATAR_R}"/></clipPath>
  <linearGradient id="shade"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.42" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient>
  <radialGradient id="spec"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="comet-tail"><stop offset="0" stop-color="${theme.comet}" stop-opacity="0"/><stop offset="1" stop-color="${theme.comet}" stop-opacity="0.85"/></linearGradient>
  <radialGradient id="comet-glow"><stop offset="0" stop-color="${theme.comet}" stop-opacity="0.6"/><stop offset="1" stop-color="${theme.comet}" stop-opacity="0"/></radialGradient>
  ${grads}
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
</defs>`;
}

// ---------- public ----------
export function renderOrbit({
  user,
  planets,
  belt = [],
  comet: lastCommit = null,
  ships = [],
  stargazers = [],
  milestones = [],
  flare = false,
  links = [],
  avatar = null,
  colors = {},
  theme: themeName = "dark",
  generatedAt = new Date(),
}) {
  const theme = THEMES[themeName];
  const { radii, beltR } = layout(planets.length, belt.length > 0);

  const orbits = planets.map((_, i) => orbitPaths(radii[i], deg(ROLLS[i % ROLLS.length])));
  const orbitStyle = `fill="none" stroke="${theme.orbit}" stroke-opacity="${theme.orbitOpacity}" stroke-width="1"`;
  const orbitBack = orbits.map((o) => `<path d="${o.back}" ${orbitStyle}/>`).join("");
  const orbitFront = orbits.map((o) => `<path d="${o.front}" ${orbitStyle}/>`).join("");

  const { durs, phases } = periods(planets, links);
  const orbitsOf = planets.map((repo, i) => orbitOf(repo, i, radii[i], durs[i], phases[i]));
  const now = generatedAt.getTime();
  const DAY = 24 * 3600 * 1000;
  const shown = planets.map((repo) => ({
    ...repo,
    active: Date.parse(repo.pushedAt) >= now - DAY,
    abandoned: Date.parse(repo.pushedAt) < now - 182 * DAY,
    flagTag:
      repo.customFlag ??
      (repo.latestRelease?.tag && Date.parse(repo.latestRelease.at) >= now - 7 * DAY ? repo.latestRelease.tag : null),
  }));
  const built = shown.map((repo, i) => planet(repo, i, orbitsOf[i], theme));
  // each pilot's avatar is embedded once, however many ships they fly
  const pilotIds = new Map();
  const crew = ships
    .filter((s) => orbitsOf[s.target])
    .map((s) => {
      if (s.avatar && !pilotIds.has(s.login)) pilotIds.set(s.login, { id: pilotIds.size, avatar: s.avatar });
      return { ...s, pilotId: s.avatar ? pilotIds.get(s.login).id : null };
    });
  const pilotDefs = [...pilotIds.values()]
    .map((p) => `<image id="pilot-${p.id}" href="${p.avatar}" x="-8" y="-8" width="16" height="16" preserveAspectRatio="xMidYMid slice"/>`)
    .join("");
  const fleet = crew.map((s, k) => ship(s, k, orbitsOf[s.target], theme)).join("\n  ");
  const all = [...planets, ...belt];
  const stars = all.reduce((n, r) => n + r.stars, 0);

  const bits = [`${all.length} repos in orbit`, `★ ${stars}`, `${user.followers} followers`];
  if (user.contributions != null) bits.push(`${user.contributions} contributions / yr`);
  const stats = bits.join("  ·  ");
  const date = generatedAt.toISOString().slice(0, 10);

  const empty = all.length === 0
    ? `<text x="${CX}" y="${CY + 110}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${theme.muted}">no public repos yet, first planet incoming</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Animated 3D orbit of ${esc(user.login)}'s repositories">
<title>${esc(user.login)}: repo orbit</title>
${defs(theme, shown, colors)}
${pilotDefs ? `<defs>${pilotDefs}</defs>` : ""}
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${starfield(theme, hash(user.login))}
  ${orbitBack}
  ${built.map((b) => b.back).join("\n  ")}
  ${linkBeams(links, planets, orbitsOf, theme)}
  ${asteroidBelt(belt, beltR, theme, colors, hash(user.login + "belt"))}
  ${sun(theme, user.login, avatar, flare)}
  ${orbitFront}
  ${built.map((b) => b.front).join("\n  ")}
  ${shootingStars(stargazers, theme)}
  ${fleet}
  ${station(user.recentWeeks, theme)}
  ${fireworks(milestones, theme)}
  ${comet(lastCommit, theme)}
  <text x="26" y="34" font-family="${MONO}" font-size="12" font-weight="700" letter-spacing="3" fill="${theme.text}">REPO ORBIT</text>
  <text x="26" y="52" font-family="${MONO}" font-size="10.5" fill="${theme.muted}">@${esc(user.login)}</text>
  <text x="${W - 26}" y="34" text-anchor="end" font-family="${MONO}" font-size="10.5" fill="${theme.muted}">synced ${date}</text>
  ${empty}
  <text x="${CX}" y="${H - 18}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${theme.muted}" xml:space="preserve">${esc(stats)}</text>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="${theme.border}"/>
</svg>
`;
}

// The colour key for the README: every language in the orbit, most used first.
export function renderLegend({ repos, theme: themeName = "dark", colors = {} }) {
  const theme = THEMES[themeName];
  const counts = new Map();
  for (const r of repos) {
    const k = r.language ?? "Other";
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const items = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const rowH = 26;
  let x = 0;
  let y = 0;
  let out = "";
  for (const [name, n] of items) {
    const w = 18 + (name.length + String(n).length + 1) * 7.3 + 26;
    if (x > 0 && x + w > W) {
      x = 0;
      y += rowH;
    }
    const color = name === "Other" ? NO_LANG : langColor(name, colors);
    out +=
      `<circle cx="${r1(x + 6)}" cy="${y + 13}" r="6" fill="${color}"/>` +
      `<text x="${r1(x + 18)}" y="${y + 17.5}" font-family="${MONO}" font-size="12" fill="${theme.text}">${esc(name)} <tspan fill="${theme.muted}">${n}</tspan></text>`;
    x += w;
  }
  const h = y + rowH;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img" aria-label="Languages in the orbit">
${out}
</svg>
`;
}
