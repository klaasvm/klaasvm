// Fetches the data the orbit is built from. Zero dependencies (Node 20+ fetch).

const API = "https://api.github.com";
const LINGUIST = "https://raw.githubusercontent.com/github-linguist/linguist/main/lib/linguist/languages.yml";

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "repo-orbit",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function rest(path, token) {
  const res = await fetch(API + path, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return res.json();
}

async function paged(path, token) {
  const all = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= 5; page++) {
    const batch = await rest(`${path}${sep}per_page=100&page=${page}`, token);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

function warn(msg) {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`);
}

// Contributions this year, and commits in the last 24 hours (solar flares).
// Both need a token; without one they're simply left out.
async function activity(login, token) {
  const none = { contributions: null, commits24h: null, recentWeeks: null };
  if (!token) return none;
  try {
    const now = new Date();
    const res = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        query:
          "query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){" +
          "year:contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}" +
          "day:contributionsCollection(from:$from,to:$to){totalCommitContributions}}}",
        variables: { login, from: new Date(now - 24 * 3600 * 1000).toISOString(), to: now.toISOString() },
      }),
    });
    if (!res.ok) return none;
    const user = (await res.json())?.data?.user;
    const weeks = user?.year?.contributionCalendar?.weeks ?? [];
    return {
      contributions: user?.year?.contributionCalendar?.totalContributions ?? null,
      commits24h: user?.day?.totalCommitContributions ?? null,
      recentWeeks: weeks.length
        ? weeks.slice(-2).map((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, level: d.contributionLevel })))
        : null,
    };
  } catch {
    return none;
  }
}

// Private repos are only listed by /user/repos, which needs a token that belongs
// to `username` itself (a personal access token, not the Actions GITHUB_TOKEN).
// Without one we warn and fall back to public repos, so the build never breaks.
async function listRepos({ username, token, wantPrivate }) {
  if (wantPrivate) {
    if (!token) {
      warn("privateInclude lists repos but no token is set, so only public repos are shown.");
    } else {
      try {
        const me = await rest("/user", token);
        if (me.login.toLowerCase() === username.toLowerCase()) {
          return await paged("/user/repos?affiliation=owner&visibility=all&sort=pushed", token);
        }
        warn(`the token belongs to ${me.login}, not ${username}, so only public repos are shown.`);
      } catch (err) {
        warn(`the token can't list private repos (${err.message}). Add a personal access token as the ORBIT_TOKEN secret. Only public repos are shown.`);
      }
    }
  }
  return paged(`/users/${username}/repos?type=owner&sort=pushed`, token);
}

const lower = (names) => names.map((n) => n.toLowerCase());

export async function fetchData({ username, token, privateInclude = [] }) {
  const user = await rest(`/users/${username}`, token);
  const all = await listRepos({ username, token, wantPrivate: privateInclude.length > 0 });
  const allowed = lower(privateInclude);

  const repos = all
    .filter((r) => !r.fork && !r.archived && (!r.private || allowed.includes(r.name.toLowerCase())))
    .map((r) => ({
      name: r.name,
      fullName: r.full_name,
      private: Boolean(r.private),
      language: r.language,
      stars: r.stargazers_count,
      forks: r.forks_count,
      size: r.size,
      openIssues: r.open_issues_count, // GitHub counts open PRs in here too
      pages: Boolean(r.has_pages),
      pushedAt: r.pushed_at,
    }));

  const found = lower(repos.map((r) => r.name));
  const missing = privateInclude.filter((n) => !found.includes(n.toLowerCase()));
  if (missing.length) warn(`privateInclude: couldn't find ${missing.join(", ")}`);

  return {
    user: {
      login: user.login,
      followers: user.followers,
      createdAt: user.created_at,
      ...(await activity(username, token)),
    },
    repos,
  };
}

// Per planet: releases (moons), contributors (spaceships) and the latest Actions
// run (satellite). Plus the latest commit (comet) and this week's new stars
// (shooting stars). Live builds only. Repos in hideCommits never feed the comet.
// Contributors of private repos are never shown: they didn't sign up for that.
export async function fetchExtras({ planets, belt, token, username, hideCommits = [], satelliteDays = 2 }) {
  await Promise.all(
    planets.map(async (p) => {
      const rel = await releaseInfo(p.fullName, token);
      p.releases = rel.count;
      p.latestRelease = rel.latest;
      p.contributors = p.private ? [] : await contributors(p.fullName, username, token);
      p.ci = await ciStatus(p.fullName, token, satelliteDays);
    }),
  );
  // everyone (but you) who contributed to a public repo in the orbit, for milestones
  const people = new Set();
  await Promise.all(
    [...planets, ...belt].map(async (p) => {
      if (p.private) return;
      const list = p.contributors ?? (await contributors(p.fullName, username, token));
      for (const c of list) people.add(c.login.toLowerCase());
    }),
  );
  const freshest = cometSource([...planets, ...belt], hideCommits);
  return {
    contributorCount: people.size,
    lastCommit: freshest ? await latestCommit(freshest, token) : null,
    stargazers: await recentStars([...planets, ...belt], username, token),
  };
}

// Only runs from the last `maxDays` days count: no recent run, no satellite.
async function ciStatus(fullName, token, maxDays) {
  try {
    const data = await rest(`/repos/${fullName}/actions/runs?per_page=1&exclude_pull_requests=true`, token);
    const run = data.workflow_runs?.[0];
    if (!run) return null;
    if (Date.now() - Date.parse(run.updated_at) > maxDays * 24 * 3600 * 1000) return null;
    if (run.status !== "completed") return "running";
    if (run.conclusion === "success") return "success";
    if (["failure", "timed_out", "startup_failure"].includes(run.conclusion)) return "failure";
    return null; // cancelled, skipped, ...
  } catch {
    return null; // no Actions, or the token can't read them
  }
}

async function recentStars(repos, username, token, days = 7) {
  const since = Date.now() - days * 24 * 3600 * 1000;
  const h = { ...headers(token), Accept: "application/vnd.github.star+json" };
  const found = [];
  await Promise.all(
    repos
      .filter((r) => r.stars > 0 && r.fullName)
      .map(async (r) => {
        try {
          const url = `${API}/repos/${r.fullName}/stargazers?per_page=100`;
          let res = await fetch(url, { headers: h });
          if (!res.ok) return;
          const last = /[?&]page=(\d+)>; rel="last"/.exec(res.headers.get("link") || "");
          if (last) res = await fetch(`${url}&page=${last[1]}`, { headers: h }); // newest stars are on the last page
          if (!res.ok) return;
          for (const s of await res.json()) {
            if (s.user && Date.parse(s.starred_at) >= since && s.user.login.toLowerCase() !== username.toLowerCase()) {
              found.push({ login: s.user.login, repo: r.name, at: s.starred_at });
            }
          }
        } catch {
          // skip this repo
        }
      }),
  );
  return found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 3);
}

async function releaseInfo(fullName, token) {
  try {
    const res = await fetch(`${API}/repos/${fullName}/releases?per_page=1`, { headers: headers(token) });
    if (!res.ok) return { count: 0, latest: null };
    const lastPage = /[?&]page=(\d+)>; rel="last"/.exec(res.headers.get("link") || "");
    const [newest] = await res.json();
    return {
      count: lastPage ? Number(lastPage[1]) : newest ? 1 : 0,
      latest: newest ? { tag: newest.tag_name, at: newest.published_at ?? newest.created_at } : null,
    };
  } catch {
    return { count: 0, latest: null };
  }
}

async function contributors(fullName, username, token) {
  try {
    const res = await fetch(`${API}/repos/${fullName}/contributors?per_page=100`, { headers: headers(token) });
    if (res.status !== 200) return []; // 204 = empty repo
    return (await res.json())
      .filter((c) => c.type === "User" && !c.login.endsWith("[bot]") && c.login.toLowerCase() !== username.toLowerCase())
      .map((c) => ({ login: c.login, avatarUrl: c.avatar_url, contributions: c.contributions }));
  } catch {
    return [];
  }
}

// Which contributors fly in. Each planet gets up to `perPlanet` pilots who take
// turns visiting it. With more contributors than that, a different random group
// is picked every day (`seed`, normally today's date), so everyone gets a turn.
// Planets share the `max` pilots round-robin.
export function pickShips(planets, { perPlanet = 5, max = 16, seed = "" } = {}) {
  const rnd = seeded(seed);
  const queues = planets.map((p, i) => shuffle([...(p.contributors ?? [])], rnd).slice(0, perPlanet).map((c) => ({ ...c, target: i })));
  const picked = [];
  for (let round = 0; round < perPlanet && picked.length < max; round++) {
    for (const q of queues) if (q[round] && picked.length < max) picked.push(q[round]);
  }
  const count = new Map();
  for (const s of picked) {
    s.turn = count.get(s.target) ?? 0;
    count.set(s.target, s.turn + 1);
  }
  for (const s of picked) s.turns = count.get(s.target);
  return picked;
}

function seeded(seed) {
  let a = [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rnd) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

async function latestCommit(repo, token) {
  try {
    const [c] = await rest(`/repos/${repo.fullName}/commits?per_page=1`, token);
    return c ? { repo: repo.name, message: c.commit.message.split("\n")[0] } : null;
  } catch {
    return null; // empty repo, or no access
  }
}

// The SVG is shown through an <img>, which can't load external images, so the
// avatar gets embedded as a data URI.
export function fetchAvatar(login, size = 160) {
  return fetchImage(`https://github.com/${encodeURIComponent(login)}.png?size=${size}`);
}

export async function fetchImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = (res.headers.get("content-type") || "").split(";")[0];
    const type = /^image\/(png|jpeg|gif|webp)$/.test(raw) ? raw : "image/png";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// GitHub's own language colours, straight from linguist.
export async function fetchLanguageColors() {
  try {
    const res = await fetch(LINGUIST);
    if (!res.ok) return {};
    return parseLinguist(await res.text());
  } catch {
    return {};
  }
}

export function parseLinguist(yml) {
  const colors = {};
  let current = null;
  for (const line of yml.split("\n")) {
    const name = /^("?)([^\s#"-][^"]*?)\1:\s*$/.exec(line);
    if (name) {
      current = name[2];
      continue;
    }
    const color = /^ {2}color:\s*"(#[0-9a-fA-F]{6})"/.exec(line);
    if (color && current) colors[current] = color[1];
  }
  return colors;
}

export function cometSource(repos, hideCommits = []) {
  const hidden = lower(hideCommits);
  return repos.filter((r) => !hidden.includes(r.name.toLowerCase())).sort(byPush)[0] ?? null;
}

// Repos whose flag shows a version from their own site instead of the latest
// release. The file is JSON like {"version": "2.0"}.
const CUSTOM_FLAGS = {
  everythingyouneed: "https://klaasvm.github.io/everythingyouneed/website/version.json",
};

export async function fetchCustomFlags(planets) {
  await Promise.all(
    planets.map(async (p) => {
      const url = CUSTOM_FLAGS[p.name.toLowerCase()];
      if (!url) return;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const { version } = await res.json();
        if (version) p.customFlag = /^v/i.test(version) ? String(version) : `v${version}`;
      } catch {
        // site down: no custom flag this time
      }
    }),
  );
}

const byPush = (a, b) => new Date(b.pushedAt) - new Date(a.pushedAt);

// Planets: pinned repos first, then the freshest. Whatever doesn't fit becomes
// the asteroid belt. Private repos only appear when listed in privateInclude;
// repos in exclude and the profile repo itself (username/username) are left out.
export function selectPlanets(repos, { username = "", maxPlanets = 8, pin = [], privateInclude = [], exclude = [] } = {}) {
  const allowed = lower(privateInclude);
  const skip = [...lower(exclude), username.toLowerCase()];
  const pool = repos.filter(
    (r) => (!r.private || allowed.includes(r.name.toLowerCase())) && !skip.includes(r.name.toLowerCase()),
  );
  const pinned = pin.map((n) => pool.find((r) => r.name === n)).filter(Boolean);
  const ordered = [...pinned, ...pool.filter((r) => !pinned.includes(r)).sort(byPush)];
  return {
    planets: ordered.slice(0, maxPlanets).sort(byPush),
    belt: ordered.slice(maxPlanets).sort(byPush),
  };
}
