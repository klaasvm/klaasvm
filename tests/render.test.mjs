import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { labelLines, renderLegend, renderOrbit } from "../scripts/render.mjs";
import { crossMilestones, celebrating } from "../scripts/milestones.mjs";
import { cometSource, parseLinguist, pickShips, selectPlanets } from "../scripts/fetch.mjs";

const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
const cfg = { username: "klaasvm", maxPlanets: 8 };
const names = (list) => list.map((r) => r.name);

test("selectPlanets: pin and max, the rest goes to the belt", () => {
  const { planets, belt } = selectPlanets(sample.repos, { ...cfg, maxPlanets: 3, pin: ["snippets"] });
  assert.equal(planets.length, 3);
  assert.ok(names(planets).includes("snippets"));
  assert.equal(planets.length + belt.length, 12);
});

test("selectPlanets: private repos only when included, profile repo never", () => {
  const hidden = selectPlanets(sample.repos, cfg);
  const all = names([...hidden.planets, ...hidden.belt]);
  assert.ok(!all.includes("secret-client-site"));
  assert.ok(!all.includes("klaasvm"));

  const shown = selectPlanets(sample.repos, { ...cfg, privateInclude: ["Secret-Client-Site"] });
  assert.ok(names(shown.planets).includes("secret-client-site"));
});

for (const theme of ["dark", "light"]) {
  test(`renders a sane ${theme} svg`, () => {
    const { planets, belt } = selectPlanets(sample.repos, cfg);
    const svg = renderOrbit({ user: sample.user, planets, belt, comet: sample.lastCommit, theme });
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.trimEnd().endsWith("</svg>"));
    assert.ok(!svg.includes("NaN") && !svg.includes("undefined"));
    assert.equal((svg.match(/class="pl-front"/g) || []).length, planets.length);
    assert.equal((svg.match(/class="pl-back"/g) || []).length, planets.length);
    assert.equal((svg.match(/class="asteroid"/g) || []).length, belt.length);
    assert.ok(svg.includes('class="moon"'));
    assert.ok(svg.includes("dark mode for the tool pages"));
    assert.ok(svg.length < 450 * 1024, "svg should stay lightweight");
  });
}

test("avatar goes in the sun, login text without one", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const withAvatar = renderOrbit({ user: sample.user, planets, avatar: "data:image/png;base64,AAAA" });
  assert.ok(withAvatar.includes('<image href="data:image/png;base64,AAAA"'));
  const without = renderOrbit({ user: sample.user, planets });
  assert.ok(!without.includes("<image"));
  assert.ok(without.includes('font-weight="700" fill="#3a1500">klaasvm</text>'));
});

test("renders with zero repos and escapes names and commit messages", () => {
  const svg = renderOrbit({
    user: { login: "a<b", followers: 0, contributions: null },
    planets: [],
    comet: { repo: "x", message: "fix <script> & stuff" },
  });
  assert.ok(svg.includes("a&lt;b"));
  assert.ok(svg.includes("fix &lt;script&gt; &amp; stuff"));
  assert.ok(svg.includes("first planet incoming"));
});

test("planets are visible without SMIL (initial opacity is frame 0)", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const svg = renderOrbit({ user: sample.user, planets });
  const initial = [...svg.matchAll(/class="pl-front" data-repo="[^"]*" transform="[^"]+" opacity="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(initial.some((o) => o !== "0"));
});

test("planet colour is GitHub's language colour", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const svg = renderOrbit({ user: sample.user, planets, colors: { JavaScript: "#123456" } });
  assert.ok(svg.includes('stop-color="#123456"'));
});

test("legend lists languages, most used first", () => {
  const { planets, belt } = selectPlanets(sample.repos, cfg);
  const svg = renderLegend({ repos: [...planets, ...belt] });
  assert.ok(svg.indexOf(">JavaScript ") < svg.indexOf(">Lua "));
  assert.ok(svg.includes("#f1e05a"));
});

test("parseLinguist reads names and colours", () => {
  const yml = '---\nJavaScript:\n  type: programming\n  color: "#f1e05a"\n"1C Enterprise":\n  color: "#814CCC"\nText:\n  type: prose\n';
  assert.deepEqual(parseLinguist(yml), { JavaScript: "#f1e05a", "1C Enterprise": "#814CCC" });
});

test("exclude drops repos, case-insensitively", () => {
  const { planets, belt } = selectPlanets(sample.repos, { ...cfg, exclude: ["Side-Quests", "dotfiles"] });
  const all = names([...planets, ...belt]);
  assert.ok(!all.includes("side-quests") && !all.includes("dotfiles"));
});

test("hideCommits keeps a repo out of the comet", () => {
  const { planets, belt } = selectPlanets(sample.repos, cfg);
  assert.equal(cometSource([...planets, ...belt]).name, "everythingyouneed");
  assert.equal(cometSource([...planets, ...belt], ["everythingyouneed"]).name, "side-quests");
});

test("a planet image replaces the gradient and is embedded once", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const withImage = planets.map((p, i) => (i === 0 ? { ...p, image: "data:image/png;base64,QUJD" } : p));
  const svg = renderOrbit({ user: sample.user, planets: withImage });
  assert.equal(svg.split("data:image/png;base64,QUJD").length - 1, 1);
  assert.equal((svg.match(/<use href="#tex-0"/g) || []).length, 2);
  assert.ok(!svg.includes('href="#tex-1"'));
});

test("ships: one per planet's top contributor, flying to the right planet", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const ships = pickShips(planets);
  assert.deepEqual(ships.map((s) => s.login), ["octocat", "monalisa"]);
  const svg = renderOrbit({ user: sample.user, planets, ships });
  assert.equal((svg.match(/class="ship"/g) || []).length, 2);
  assert.ok(svg.includes("@octocat"));
  assert.ok(!svg.includes("NaN"));
  for (const m of svg.matchAll(/keyTimes="([^"]+)"/g)) {
    const kt = m[1].split(";").map(Number);
    assert.equal(kt[0], 0);
    assert.equal(kt.at(-1), 1);
    assert.ok(kt.every((v, i) => i === 0 || v >= kt[i - 1]), "keyTimes must not go backwards");
  }
});

test("pages repos get a dish", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const svg = renderOrbit({ user: sample.user, planets });
  const withPages = planets.filter((p) => p.pages).length;
  assert.equal((svg.match(/class="dish"/g) || []).length, withPages * 2); // back + front copy
});

test("satellites, volcano and shooting stars show up where they should", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const svg = renderOrbit({
    user: sample.user,
    planets,
    stargazers: sample.recentStars,
    generatedAt: new Date("2026-11-16T22:00:00Z"),
  });
  const withCi = planets.filter((p) => p.ci).length;
  assert.equal((svg.match(/class="satellite"/g) || []).length, withCi * 4); // back+front sat, in back+front planet copy
  assert.equal((svg.match(/class="volcano"/g) || []).length, 2); // only everythingyouneed pushed < 24h ago
  assert.equal((svg.match(/class="shooting-star"/g) || []).length, 2);
  assert.ok(svg.includes("★ @octocat starred kdenlive-presets"));
  assert.ok(!svg.includes("NaN"));
});

test("a planet logo is smaller than the planet", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const svg = renderOrbit({ user: sample.user, planets: planets.map((p, i) => (i === 0 ? { ...p, image: "data:image/png;base64,QUJD" } : p)) });
  const clip = Number(/<clipPath id="tex-clip-0"><circle r="([\d.]+)"/.exec(svg)[1]);
  const planetR = Number(/data-repo="everythingyouneed"[\s\S]*?fill="url\(#glow-0\)"\/><g[\s\S]*?<circle r="([\d.]+)" fill="url\(#pl-0\)"/.exec(svg)?.[1] ?? /<circle r="([\d.]+)" fill="url\(#pl-0\)"/.exec(svg)[1]);
  assert.ok(clip < planetR * 0.75);
});

test("long names wrap after a dash, everythingyouneed is the longest line", () => {
  assert.deepEqual(labelLines("chiro-blanden-verhuur-api"), ["chiro-blanden-", "verhuur-api"]);
  assert.deepEqual(labelLines("everythingyouneed-releases"), ["everythingyouneed-", "releases"]);
  assert.deepEqual(labelLines("everythingyouneed"), ["everythingyouneed"]);
  assert.deepEqual(labelLines("chiro-blanden"), ["chiro-blanden"]);
});

test("flag, craters, flares and link beams", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const at = new Date("2026-11-16T22:00:00Z");
  const svg = renderOrbit({ user: sample.user, planets, generatedAt: at, flare: true, links: [["time-tool", "kdenlive-presets"], ["nope", "time-tool"]] });
  assert.equal((svg.match(/class="flag"/g) || []).length, 2); // kdenlive-presets v2.1, back + front copy
  assert.ok(svg.includes(">v2.1</text>"));
  assert.ok(svg.includes('fill-opacity="0.45"'), "snippets is abandoned and gets craters");
  assert.ok(svg.includes('class="flare"'));
  assert.equal((svg.match(/class="link"/g) || []).length, 1); // unknown repo is ignored
  assert.ok(!svg.includes("NaN"));
  const calm = renderOrbit({ user: sample.user, planets, generatedAt: at });
  assert.ok(!calm.includes('class="flare"') && !calm.includes('class="link"'));
});

test("space station carries the last two weeks of contributions", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const svg = renderOrbit({ user: sample.user, planets });
  assert.ok(svg.includes('class="station"'));
  assert.ok(!svg.includes("last 2 weeks"));
  assert.ok(svg.includes("#39d353")); // a 12-contribution day
  const none = renderOrbit({ user: { ...sample.user, recentWeeks: null }, planets });
  assert.ok(!none.includes('class="station"'));
});

test("a custom flag wins over the release tag and needs no recent release", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const custom = planets.map((p) => (p.name === "everythingyouneed" ? { ...p, customFlag: "v2.0" } : p));
  const svg = renderOrbit({ user: sample.user, planets: custom, generatedAt: new Date("2026-11-16T22:00:00Z") });
  assert.ok(svg.includes(">v2.0</text>"));
});

test("many contributors take turns, and the group changes per day", () => {
  const crowd = Array.from({ length: 30 }, (_, n) => ({ login: `dev${n}`, contributions: 30 - n }));
  const planets = [{ name: "big", stars: 0, size: 100, pushedAt: "2026-11-01T00:00:00Z", language: "Go", contributors: crowd }];
  const monday = pickShips(planets, { seed: "2026-11-16" });
  const tuesday = pickShips(planets, { seed: "2026-11-17" });
  assert.equal(monday.length, 5);
  assert.deepEqual(monday.map((s) => s.turn), [0, 1, 2, 3, 4]);
  assert.ok(monday.every((s) => s.turns === 5));
  assert.notDeepEqual(monday.map((s) => s.login), tuesday.map((s) => s.login));

  const svg = renderOrbit({ user: sample.user, planets, ships: monday.map((s) => ({ ...s, avatar: "data:image/png;base64,QUJD" })) });
  assert.equal((svg.match(/class="ship"/g) || []).length, 5);
  assert.equal(svg.split("data:image/png;base64,QUJD").length - 1, 5); // one avatar per pilot
  const durs = [...svg.matchAll(/class="ship"[\s\S]*?dur="([\d.]+)s"/g)].map((m) => m[1]);
  assert.equal(new Set(durs).size, 1, "all turns share one loop");
  assert.ok(!svg.includes("NaN"));
});

test("dish and flag on one planet take turns, overlapping only briefly", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const both = planets.map((p) => (p.name === "everythingyouneed" ? { ...p, customFlag: "v2.0" } : p));
  const svg = renderOrbit({ user: sample.user, planets: both });
  const part = svg.split('data-repo="everythingyouneed"')[1];
  const dish = /class="dish"[\s\S]*?keyTimes="([^"]+)" dur="20s" begin="([^"]+)s"/.exec(part);
  const flag = /class="flag"[\s\S]*?keyTimes="([^"]+)" dur="20s" begin="([^"]+)s"/.exec(part);
  assert.equal(dish[2], flag[2], "same loop, same start");
  const [d, f] = [dish[1].split(";").map(Number), flag[1].split(";").map(Number)];
  const overlap = Math.min(d[4], f[4]) - Math.max(d[1], f[1]);
  assert.ok(overlap > 0 && overlap < 0.2, `overlap ${overlap}`);
});

test("milestones: baseline first, then fireworks for numbers crossed, not twice", () => {
  const t0 = new Date("2026-11-10T04:00:00Z");
  const t1 = new Date("2026-11-11T04:00:00Z");
  const base = crossMilestones(null, { followers: 9, stars: 30, contributors: 2 }, t0);
  assert.deepEqual(base.reached, [], "first run only records a baseline");
  const next = crossMilestones(base, { followers: 10, stars: 30, contributors: 3, contributions: null }, t1);
  assert.deepEqual(next.reached.map((r) => `${r.metric}:${r.value}`), ["followers:10", "contributors:3"]);
  assert.equal(next.values.contributions, undefined);
  const dip = crossMilestones(crossMilestones(next, { followers: 9 }, t1), { followers: 10 }, t1);
  assert.equal(dip.reached.length, 2, "dipping and coming back doesn't celebrate again");
  assert.deepEqual(celebrating(next, t1).map((m) => m.label), ["10 followers", "3 contributors"]);
  assert.deepEqual(celebrating(next, new Date("2026-11-30T00:00:00Z")), [], "a week later it's over");
});

test("fireworks render with their label", () => {
  const { planets } = selectPlanets(sample.repos, cfg);
  const svg = renderOrbit({ user: sample.user, planets, milestones: sample.milestones });
  assert.equal((svg.match(/class="fireworks"/g) || []).length, 2);
  assert.ok(svg.includes("✦ 25 stars ✦"));
  assert.ok(!svg.includes("NaN"));
});
