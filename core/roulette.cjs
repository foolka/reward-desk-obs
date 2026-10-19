const { chooseCycle } = require("./model.cjs");
const { forItem } = require("../overlay/caption.js");

function cycleKey(reward, event) {
  return (
    "roulette:" +
    JSON.stringify([
      reward.account || reward.chatAccount || event?.account || "",
      reward.clientId || reward.chatClientId || "",
      reward.id,
    ])
  );
}
function playedKey(key) {
  return "roulette-played:" + key.slice(9);
}
function poolFor(reward) {
  return reward.items.map((item) => ({
    ...item,
    captionText: forItem(reward.video, item).caption.text,
  }));
}
function initialPlayed(store, key, reward) {
  const saved = store.meta(playedKey(key));
  if (saved) return saved;
  const legacy = store.meta(key, {});
  const [account, client] = JSON.parse(key.slice(9));
  const jobs = store
    .jobs()
    .filter(
      (job) =>
        job.rewardId === reward.id &&
        job.item &&
        (!job.selection ||
          (job.selection.key === key && job.selection.mode !== "fixed")) &&
        (!job.account || job.account === account) &&
        (!job.clientId || job.clientId === client),
    );
  let state = legacy;
  if (jobs.length) {
    state = { used: [], last: "" };
    const active = reward.items
      .filter((item) => item.weight > 0)
      .map((item) => item.id);
    // Old versions reserved whole cycles on enqueue. Replay only actual starts.
    for (const job of jobs
      .filter((job) => job.startedAt)
      .sort(
        (a, b) =>
          (a.cycleStartedAt || a.startedAt) - (b.cycleStartedAt || b.startedAt),
      )) {
      if (job.selection?.mode === "random") {
        state = { used: [], last: job.item.id };
        continue;
      }
      if (active.length && active.every((id) => state.used.includes(id)))
        state.used = [];
      state.used = [...new Set([...state.used, job.item.id])];
      state.last = job.item.id;
    }
  }
  store.setMeta(playedKey(key), state);
  return state;
}
function reserve(job, state, rng) {
  if (job.selection.mode === "random") return { used: [], last: job.item.id };
  const pool = job.selection.pool;
  const keepCurrent = (total) => {
    const used = new Set(state.used || []);
    let remaining = pool.filter(
      (item) => item.weight > 0 && !used.has(item.id),
    );
    if (!remaining.length) {
      remaining = pool.filter((item) => item.weight > 0);
      if (remaining.length > 1)
        remaining = remaining.filter((item) => item.id !== state.last);
    } else if (!used.size && remaining.length > 1) {
      remaining = remaining.filter((item) => item.id !== state.last);
    }
    let offset = 0;
    for (const item of remaining) {
      if (item.id === job.item.id) return offset;
      offset += item.weight;
    }
    return rng ? rng(total) : require("node:crypto").randomInt(total);
  };
  const { selected, cycle } = chooseCycle(pool, state, keepCurrent);
  return { selected, cycle };
}
function applyReservation(store, job, result) {
  const selected = result.selected;
  if (selected && selected.id !== job.item.id) {
    const media = store.media(selected.id);
    if (!media) throw Error("Медиа очереди не найдено");
    job.item = { ...selected, ...media };
    job.video = structuredClone(forItem(job.video, selected));
  }
  return result.cycle || result;
}
function projectQueue(store, key, reward, rng) {
  let state = initialPlayed(store, key, reward);
  for (const job of store.jobs()) {
    if (
      job.state !== "queued" ||
      job.startedAt ||
      job.rewardId !== reward.id ||
      !job.item
    )
      continue;
    const before = JSON.stringify(job);
    if (!job.selection) {
      const [account, client] = JSON.parse(key.slice(9));
      if (
        (job.account && job.account !== account) ||
        (job.clientId && job.clientId !== client)
      )
        continue;
      job.selection = {
        key,
        mode: reward.allowRepeats ? "random" : "cycle",
        pool: poolFor(reward),
      };
    }
    if (job.selection.key !== key || job.selection.mode === "fixed") continue;
    state = applyReservation(store, job, reserve(job, state, rng));
    if (JSON.stringify(job) !== before) store.putJob(job);
  }
  store.setMeta(key, state);
  return state;
}
function commitStart(store, job, reward, rng) {
  if (job.startedAt || !job.selection || job.selection.mode === "fixed") return;
  const key = job.selection.key;
  const state = initialPlayed(store, key, reward);
  const next = applyReservation(store, job, reserve(job, state, rng));
  store.setMeta(playedKey(key), next);
}
module.exports = { cycleKey, poolFor, projectQueue, commitStart, playedKey };
