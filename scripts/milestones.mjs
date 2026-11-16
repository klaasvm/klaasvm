// Milestones: round numbers worth fireworks. The last known values live in
// data/milestones.json (committed by the workflow), so a build can tell when a
// number crossed a threshold since the previous run.
import { readFile, writeFile } from "node:fs/promises";

const STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
export const METRICS = {
  followers: { steps: STEPS, label: (n) => `${n} followers` },
  stars: { steps: STEPS, label: (n) => `${n} stars` },
  contributions: { steps: STEPS, label: (n) => `${n} contributions this year` },
  contributors: { steps: [3, 5, ...STEPS], label: (n) => `${n} contributors` },
};
const DAY = 24 * 3600 * 1000;
const CELEBRATE_DAYS = 7; // fireworks keep going for a week
const REPEAT_DAYS = 60; // the same milestone again (e.g. after dipping) waits this long

// Pure: previous state + current numbers -> new state. The first run only takes
// a baseline, so numbers you already had don't all go off at once.
export function crossMilestones(state, metrics, now = new Date()) {
  const values = { ...(state?.values ?? {}) };
  const reached = [...(state?.reached ?? [])];
  for (const [metric, value] of Object.entries(metrics)) {
    if (value == null || !METRICS[metric]) continue;
    const prev = values[metric];
    if (prev != null) {
      for (const step of METRICS[metric].steps) {
        const recent = reached.some((r) => r.metric === metric && r.value === step && now - Date.parse(r.at) < REPEAT_DAYS * DAY);
        if (prev < step && value >= step && !recent) reached.push({ metric, value: step, at: now.toISOString() });
      }
    }
    values[metric] = value;
  }
  return { values, reached: reached.slice(-30) };
}

export function celebrating(state, now = new Date()) {
  return (state?.reached ?? [])
    .filter((r) => now - Date.parse(r.at) < CELEBRATE_DAYS * DAY && METRICS[r.metric])
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((r) => ({ ...r, label: METRICS[r.metric].label(r.value) }));
}

export async function updateMilestones(file, metrics, now = new Date()) {
  let state = null;
  try {
    state = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // first run: start a baseline
  }
  const next = crossMilestones(state, metrics, now);
  await writeFile(file, JSON.stringify(next, null, 2) + "\n");
  return celebrating(next, now);
}
