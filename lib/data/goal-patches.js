// lib/data/goal-patches.js — goals a source left out, added by hand from a named match report. Used only when the source's goals are short by exactly these.
// `m` is the minute when the report gives it; `approx: true` means the report only says "stoppage time" etc.
export const GOAL_PATCHES = {
  'LALIGA|2026|levante|athletic club': { report: 'flashscore 2026-10-21 match report', goals: [{ side: 'home', player: 'Karl Etta Eyong', m: 90, x: null, approx: true }] }
};
