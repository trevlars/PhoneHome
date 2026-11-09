import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type Database from "better-sqlite3";
import {
  addAllowlist,
  addLine,
  canCall,
  createGuardianInvite,
  createHousehold,
  createInvite,
  householdSnapshot,
  provisionGrandparent,
  redeemGuardianInvite,
  redeemInvite,
  registerParent,
  listKidAuntUncleOptions,
  removeGuardian,
  resolveAtaDial,
  setKidAuntUncle,
  updateLine,
  upsertAtaDevice,
} from "./api.js";
import { openDb, syncGrandparentLineModes } from "./db.js";

/**
 * Family structure from docs `Sample.pdf` (South / North / West + friend Pods).
 * Grandparents are set up *before* co-parents and siblings join, the order real
 * families use — links must come from write paths, not repair scripts.
 */
function buildSampleFamilies() {
  const db = openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kl-diagram-")), "t.db"));
  const label = new Map<string, string>();
  const users: string[] = [];
  const id = (name: string) => {
    for (const [lineId, n] of label) if (n === name) return lineId;
    throw new Error(`no line ${name}`);
  };

  const parent = (name: string) => {
    const uid = registerParent(db, name, { username: `dg${name.toLowerCase()}`, password: "password1" }).user.id;
    users.push(uid);
    return uid;
  };
  const phone = (hh: string, uid: string, name: string) => {
    // Friend redeem already gives the parent a phone — reuse it like the app does.
    const existing = db
      .prepare(`SELECT id FROM lines WHERE household_id = ? AND owner_user_id = ? AND mode = 'parent' LIMIT 1`)
      .get(hh, uid) as { id: string } | undefined;
    label.set(existing?.id ?? addLine(db, hh, uid, `${name} phone`).id, name);
  };
  const kid = (hh: string, uid: string, name: string) => {
    const line = addLine(db, hh, uid, name, "softphone", { mode: "child" });
    updateLine(db, hh, line.id, { mode: "child", child_label: name }, { actorUserId: uid });
    label.set(line.id, name);
    return line.id;
  };
  const grandparent = (uid: string, hh: string, name: string, kids: string[]) => {
    const gp = provisionGrandparent(db, uid, hh, {
      displayName: name,
      username: `dg${name.toLowerCase()}`,
      password: "password1!",
      label: "Grandma",
      kidLineIds: kids,
    });
    label.set(gp.line.id, name);
    users.push(gp.line.owner_user_id);
  };
  const coParent = (inviter: string, kidId: string, invitee: string, podName: string) => {
    const inv = createGuardianInvite(db, inviter, kidId);
    redeemGuardianInvite(db, invitee, inv.code, { householdName: podName });
  };
  const joinFamily = (hh: string, inviter: string, joiner: string) => {
    redeemInvite(db, createInvite(db, hh, inviter, { kind: "family" }).code, joiner, "ignored");
  };
  const friendPod = (hh: string, inviter: string, kidId: string, redeemer: string, podName: string) =>
    redeemInvite(db, createInvite(db, hh, inviter, { kind: "friend", targetKidLineId: kidId }).code, redeemer, podName)
      .household.id;
  const approve = (hh: string, target: string, actor: string) =>
    addAllowlist(db, hh, id(target), target, { actorUserId: actor });

  // North Pod: Casey, Drew, Jordan (siblings). Grandma/Grandpa North first.
  const casey = parent("Casey");
  const drew = parent("Drew");
  const jordan = parent("Jordan");
  const north = createHousehold(db, casey, "North").id;
  phone(north, casey, "Casey");
  const quinn = kid(north, casey, "Quinn");
  grandparent(casey, north, "Avery", [quinn]);
  grandparent(casey, north, "Ellis", [quinn]);
  joinFamily(north, casey, drew);
  phone(north, drew, "Drew");
  const sam = kid(north, drew, "Sam");
  const blake = kid(north, drew, "Blake");
  joinFamily(north, casey, jordan);
  phone(north, jordan, "Jordan");

  // East (Cameron) — Alex & Riley’s other Pod.
  const cameron = parent("Cameron");
  const east = createHousehold(db, cameron, "East").id;
  phone(east, cameron, "Cameron");
  const alex = kid(east, cameron, "Alex");
  const riley = kid(east, cameron, "Riley");
  coParent(cameron, alex, jordan, "North");
  coParent(cameron, riley, jordan, "North");

  // South Pod: Reese (+ her sibling with Child H / Child I). GPs E, F first.
  const reese = parent("Reese");
  const aunt = parent("Aunt");
  const south = createHousehold(db, reese, "South").id;
  phone(south, reese, "Reese");
  grandparent(reese, south, "GrandpaE", []);
  grandparent(reese, south, "GrandmaF", []);
  joinFamily(south, reese, aunt);
  phone(south, aunt, "Aunt");
  kid(south, aunt, "ChildH");
  kid(south, aunt, "ChildI");
  coParent(casey, quinn, reese, "South");

  // West Pod: Morgan + Sister. GPs C, D first.
  const morgan = parent("Morgan");
  const sister = parent("Sister");
  const west = createHousehold(db, morgan, "West").id;
  phone(west, morgan, "Morgan");
  grandparent(morgan, west, "GrandmaC", []);
  grandparent(morgan, west, "GrandpaD", []);
  coParent(drew, sam, morgan, "West");
  coParent(drew, blake, morgan, "West");
  joinFamily(west, morgan, sister);
  phone(west, sister, "Sister");
  const nephew = kid(west, sister, "Nephew");

  // Parent D’s own Pod (GPs X, Y), co-parent of Nephew.
  const parentD = parent("ParentD");
  const dFam = createHousehold(db, parentD, "Dee").id;
  phone(dFam, parentD, "ParentD");
  grandparent(parentD, dFam, "GrandmaX", []);
  grandparent(parentD, dFam, "GrandpaY", []);
  coParent(sister, nephew, parentD, "Dee");

  // Friend family: Ken (Pod D) + spouse Parent J (Pod E); Owen is Quinn’s friend.
  const ken = parent("Ken");
  const parentJ = parent("ParentJ");
  const shorts = friendPod(north, casey, quinn, ken, "Shorts");
  phone(shorts, ken, "Ken");
  const owen = kid(shorts, ken, "Owen");
  grandparent(ken, shorts, "GrandmaG", [owen]);
  grandparent(ken, shorts, "GrandpaH", [owen]);
  const jFam = createHousehold(db, parentJ, "Jay").id;
  phone(jFam, parentJ, "ParentJ");
  grandparent(parentJ, jFam, "GrandmaI", []);
  grandparent(parentJ, jFam, "GrandpaK", []);
  coParent(ken, owen, parentJ, "Jay");
  approve(north, "Owen", casey);
  approve(shorts, "Quinn", ken);
  approve(north, "Ken", casey);
  approve(shorts, "Casey", ken);

  // Child D: Sam & Blake’s friend. Child K: Nephew’s friend.
  const dDad = parent("DDad");
  const dHouse = friendPod(north, drew, sam, dDad, "Dees");
  phone(dHouse, dDad, "DDad");
  kid(dHouse, dDad, "ChildD");
  approve(north, "ChildD", drew);
  approve(dHouse, "Sam", dDad);
  approve(dHouse, "Blake", dDad);
  const kMom = parent("KMom");
  const kHouse = friendPod(west, sister, nephew, kMom, "Kays");
  phone(kHouse, kMom, "KMom");
  kid(kHouse, kMom, "ChildK");
  approve(west, "ChildK", sister);
  approve(kHouse, "Nephew", kMom);

  return { db, label, users, id, north, east, casey, drew, jordan, cameron, reese, quinn, sam, blake, alex, riley };
}

const northGps = ["Avery", "Ellis"];
const southGps = ["GrandpaE", "GrandmaF"];
const westGps = ["GrandmaC", "GrandpaD"];

/** Who each line may call, straight from the Sample circles. */
const EXPECTED: Record<string, string[]> = {
  // Kids
  Quinn: ["Reese", "Casey", ...northGps, ...southGps, "Alex", "Riley", "Sam", "Blake", "ChildH", "ChildI", "Owen"],
  Sam: ["Drew", "Morgan", ...northGps, ...westGps, "Blake", "Quinn", "Alex", "Riley", "Nephew", "ChildD"],
  Blake: ["Drew", "Morgan", ...northGps, ...westGps, "Sam", "Quinn", "Alex", "Riley", "Nephew", "ChildD"],
  Nephew: ["Sister", "ParentD", ...westGps, "GrandmaX", "GrandpaY", "Sam", "Blake", "ChildK"],
  Owen: ["Ken", "ParentJ", "GrandmaG", "GrandpaH", "GrandmaI", "GrandpaK", "Quinn"],
  Alex: ["Cameron", "Jordan", ...northGps, "Riley", "Quinn", "Sam", "Blake"],
  ChildH: ["Aunt", ...southGps, "ChildI", "Quinn"],
  // Parents
  Casey: [...northGps, "Reese", "Drew", "Jordan", "Ken", "Quinn"],
  Drew: [...northGps, "Morgan", "Casey", "Jordan", "Sam", "Blake", "DDad"],
  Jordan: [...northGps, "Cameron", "Casey", "Drew", "Alex", "Riley"],
  Reese: [...southGps, "Casey", "Aunt", "Quinn"],
  Morgan: [...westGps, "Drew", "Sister", "Sam", "Blake"],
  Sister: [...westGps, "Morgan", "ParentD", "Nephew", "KMom"],
  ParentD: ["GrandmaX", "GrandpaY", "Sister", "Nephew"],
  Ken: ["GrandmaG", "GrandpaH", "ParentJ", "Casey", "Owen"],
  // Grandparents
  Avery: ["Casey", "Drew", "Jordan", "Quinn", "Sam", "Blake", "Alex", "Riley"],
  GrandmaC: ["Morgan", "Sister", "Sam", "Blake", "Nephew"],
  GrandpaE: ["Reese", "Aunt", "Quinn", "ChildH", "ChildI"],
  GrandmaX: ["ParentD", "Nephew"],
  GrandmaG: ["Ken", "Owen"],
  GrandmaI: ["ParentJ", "Owen"],
};

function callDiff(db: Database.Database, label: Map<string, string>, id: (n: string) => string) {
  const problems: string[] = [];
  for (const [who, allowed] of Object.entries(EXPECTED)) {
    const from = id(who);
    const can = [...label.keys()]
      .filter((to) => to !== from && canCall(db, from, to).ok)
      .map((to) => label.get(to)!);
    const extra = can.filter((n) => !allowed.includes(n));
    const missing = allowed.filter((n) => !can.includes(n));
    if (extra.length) problems.push(`${who} can call (should not): ${extra.join(", ")}`);
    if (missing.length) problems.push(`${who} cannot call (should): ${missing.join(", ")}`);
  }
  return problems;
}

test("Sample families: every circle matches the diagram, before and after app loads", () => {
  const f = buildSampleFamilies();
  assert.deepEqual(callDiff(f.db, f.label, f.id), [], "write paths only");
  for (const uid of f.users) householdSnapshot(f.db, uid);
  assert.deepEqual(callDiff(f.db, f.label, f.id), [], "after every account loads the app");
  f.db.close();
});

test("Sample families: house phone 2 reaches this kid’s own co-parent on a shared Pod", () => {
  const f = buildSampleFamilies();
  const dial = (kidId: string, digit: string) => {
    const ata = upsertAtaDevice(f.db, kidId, { sip_server: "sip.example.test" });
    const r = resolveAtaDial(f.db, ata.sip_extension, digit);
    return r.ok && "toLineId" in r ? f.label.get(r.toLineId) : `blocked: ${!r.ok ? r.reason : "?"}`;
  };
  assert.equal(dial(f.quinn, "2"), "Reese");
  assert.equal(dial(f.sam, "2"), "Morgan");
  assert.equal(dial(f.blake, "2"), "Morgan");
  f.db.close();
});

test("each kid’s house phone is independent — no slot for another kid’s friend", () => {
  const f = buildSampleFamilies();
  const stored = (
    f.db
      .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(f.north, f.id("Owen")) as { speed_dial: number | null }
  ).speed_dial;
  assert.notEqual(stored, 2, "friend kids never take 2");
  const owenSlot = 9;
  f.db.prepare(`UPDATE allowlist SET speed_dial = NULL WHERE household_id = ? AND speed_dial = ?`).run(f.north, owenSlot);
  f.db
    .prepare(`UPDATE allowlist SET speed_dial = ? WHERE household_id = ? AND target_line_id = ?`)
    .run(owenSlot, f.north, f.id("Owen"));
  const dial = (kidId: string, digit: string) => {
    const ata = upsertAtaDevice(f.db, kidId, { sip_server: "sip.example.test" });
    const r = resolveAtaDial(f.db, ata.sip_extension, digit);
    return r.ok && "toLineId" in r ? f.label.get(r.toLineId) : `none: ${!r.ok ? r.reason : "?"}`;
  };
  assert.equal(dial(f.quinn, String(owenSlot)), "Owen");
  assert.match(String(dial(f.sam, String(owenSlot))), /No speed-dial contact/, "no Owen placeholder");
  assert.equal(dial(f.sam, "2"), "Morgan");
  f.db.close();
});

test("review account: Test reaches Cameron’s phone only — never his kids or anyone else", () => {
  const f = buildSampleFamilies();
  f.db.prepare(`UPDATE users SET username = 'cameron' WHERE id = ?`).run(f.cameron);
  const test = registerParent(f.db, "Test", { username: "test", password: "password1" }).user.id;
  const tester = createHousehold(f.db, test, "Tester").id;
  const testLine = addLine(f.db, tester, test, "Test phone").id;
  addAllowlist(f.db, tester, f.id("Cameron"), "Cameron", { actorUserId: test });
  assert.equal(canCall(f.db, testLine, f.id("Cameron")).ok, true);
  assert.equal(canCall(f.db, f.id("Cameron"), testLine).ok, true);
  assert.equal(canCall(f.db, testLine, f.alex).ok, false, "not Cameron’s kid line");
  assert.equal(canCall(f.db, testLine, f.id("Casey")).ok, false);
  const pad = householdSnapshot(f.db, test).households.find((h) => h.id === tester)!;
  assert.deepEqual(pad.reach?.[testLine], [f.id("Cameron")]);
  f.db.close();
});

test("Sample families: kid pads only show their own parents from a shared Pod book", () => {
  const f = buildSampleFamilies();
  const northFor = (uid: string) => householdSnapshot(f.db, uid).households.find((h) => h.id === f.north)!;
  const row = (uid: string, name: string) =>
    northFor(uid).allowlist.find((a) => a.target_line_id === f.id(name)) as
      | { kid_circle_kid_ids?: string[] | null }
      | undefined;
  assert.deepEqual(row(f.casey, "Reese")?.kid_circle_kid_ids, [f.quinn], "Reese is Quinn’s Mom only");
  assert.deepEqual(
    [...(row(f.drew, "Morgan")?.kid_circle_kid_ids || [])].sort(),
    [f.sam, f.blake].sort(),
    "Morgan is Sam & Blake’s Mom only"
  );
  assert.deepEqual(row(f.casey, "Ken")?.kid_circle_kid_ids, [], "friend parent stays off kid pads");
  f.db.close();
});

test("aunts/uncles reach a kid only after that kid’s parent adds them", () => {
  const f = buildSampleFamilies();
  f.db.prepare(`UPDATE users SET parent_title = 'dad' WHERE id = ?`).run(f.casey);
  const casey = f.id("Casey");
  assert.equal(canCall(f.db, f.alex, casey).ok, false, "not automatic from sharing North");

  const opts = listKidAuntUncleOptions(f.db, f.alex);
  const caseyOpt = opts.find((o) => o.id === casey);
  assert.equal(caseyOpt?.label, "Uncle Casey");
  assert.equal(caseyOpt?.on, false);
  assert.ok(!opts.some((o) => o.id === f.id("Jordan") || o.id === f.id("Cameron")), "own parents aren’t options");
  assert.ok(!opts.some((o) => o.id === f.id("Avery")), "grandparents aren’t aunts/uncles");

  assert.throws(() => setKidAuntUncle(f.db, f.casey, f.alex, casey, true), /parents/);
  setKidAuntUncle(f.db, f.jordan, f.alex, casey, true);
  assert.equal(canCall(f.db, f.alex, casey).ok, true);
  assert.equal(canCall(f.db, casey, f.alex).ok, true);
  assert.equal(canCall(f.db, f.riley, casey).ok, false, "only the kid it was added for");
  assert.equal(canCall(f.db, f.quinn, f.id("Jordan")).ok, false, "Aunt Jordan still off Quinn’s pad");

  assert.throws(
    () => setKidAuntUncle(f.db, f.jordan, f.alex, f.id("Ken"), true),
    /aunts and uncles/,
    "friend parents can’t be added this way"
  );
  setKidAuntUncle(f.db, f.cameron, f.alex, casey, false);
  assert.equal(canCall(f.db, f.alex, casey).ok, false);
  f.db.close();
});

test("a parent approving family on their own dialpad is theirs — not the grandparents’ or kids’", () => {
  const f = buildSampleFamilies();
  const cameron = f.id("Cameron");
  const casey = f.id("Casey");
  const sloan = provisionGrandparent(f.db, f.cameron, f.east, {
    displayName: "Sloan",
    username: "dgsloan",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [f.alex],
  }).line.id;
  f.label.set(sloan, "Sloan");
  assert.equal(canCall(f.db, cameron, casey).ok, false);
  addAllowlist(f.db, f.east, casey, "Casey", { actorUserId: f.cameron });
  assert.equal(canCall(f.db, cameron, casey).ok, true, "Cameron ↔ Casey (family: Alex’s uncle)");
  assert.equal(canCall(f.db, casey, cameron).ok, true);
  const cameronPad = householdSnapshot(f.db, f.cameron).households.find((h) => h.id === f.east)!;
  assert.ok(cameronPad.reach?.[cameron]?.includes(casey), "on Cameron’s pad");
  const caseyPad = householdSnapshot(f.db, f.casey).households.find((h) => h.id === f.north)!;
  assert.ok(caseyPad.reach?.[casey]?.includes(cameron), "on Casey’s pad");
  assert.equal(canCall(f.db, sloan, casey).ok, false, "not on East grandparents’ phones");
  const sloanView = householdSnapshot(f.db, (f.db.prepare(`SELECT owner_user_id FROM lines WHERE id = ?`).get(sloan) as { owner_user_id: string }).owner_user_id);
  assert.ok(
    !sloanView.households.some((h) => (h.reach?.[sloan] || []).includes(casey)),
    "not on Sloan’s pad"
  );
  assert.equal(canCall(f.db, f.alex, casey).ok, false, "not on the kids’ pads");
  assert.equal(canCall(f.db, cameron, f.id("Drew")).ok, false, "only who he approved");
  f.db.close();
});

test("a co-parent row on a shared Pod book speaks for that kid’s parents only", () => {
  const f = buildSampleFamilies();
  // Leftover rows like live: Jordan on West, Casey on East.
  const west = (f.db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(f.id("Morgan")) as {
    household_id: string;
  }).household_id;
  addAllowlist(f.db, west, f.id("Jordan"), "Jordan", { skipKidFanout: true });
  addAllowlist(f.db, f.east, f.id("Casey"), "Casey", { skipKidFanout: true });
  assert.equal(canCall(f.db, f.id("Morgan"), f.id("Jordan")).ok, false, "Morgan is Drew’s co-parent, not Jordan’s");
  assert.equal(canCall(f.db, f.id("Cameron"), f.id("Casey")).ok, false, "Cameron is Jordan’s co-parent, not Casey’s");
  assert.equal(canCall(f.db, f.id("Morgan"), f.id("Drew")).ok, true);
  assert.equal(canCall(f.db, f.id("Cameron"), f.id("Jordan")).ok, true);
  const caseyNorth = householdSnapshot(f.db, f.casey).households.find((h) => h.id === f.north)!;
  const caseyPad = new Set(caseyNorth.allowlist.map((a) => a.target_line_id));
  assert.equal(caseyPad.has(f.id("Morgan")), false, "not on Casey’s pad");
  assert.equal(caseyPad.has(f.id("Cameron")), false, "not on Casey’s pad");
  assert.equal(caseyPad.has(f.id("Reese")), true, "his own co-parent stays");
  f.db.close();
});

test("grandparent phones are mode=grandparent: set on provision, kept on edit, backfilled on boot", () => {
  const f = buildSampleFamilies();
  const modeOf = (name: string) =>
    (f.db.prepare(`SELECT mode FROM lines WHERE id = ?`).get(f.id(name)) as { mode: string }).mode;
  for (const gp of ["Avery", "Ellis", "GrandmaC", "GrandpaE", "GrandmaX", "GrandmaG"]) {
    assert.equal(modeOf(gp), "grandparent", gp);
  }
  assert.equal(modeOf("Casey"), "parent");
  assert.equal(modeOf("Quinn"), "child");

  const avery = f.id("Avery");
  const hh = (f.db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(avery) as { household_id: string })
    .household_id;
  updateLine(f.db, hh, avery, { mode: "child", name: "Grandma's phone" });
  assert.equal(modeOf("Avery"), "grandparent", "Parent UI can’t flip a grandparent phone");

  const averyBook = (
    f.db
      .prepare(
        `SELECT a.label FROM allowlist a JOIN provisioned_relatives p ON p.relative_household_id = a.household_id
         WHERE p.relative_line_id = ? AND a.target_line_id IN (?, ?, ?)`
      )
      .all(avery, f.id("Casey"), f.id("Drew"), f.id("Jordan")) as { label: string }[]
  ).map((r) => r.label);
  assert.deepEqual(averyBook.sort(), ["Jordan", "Casey", "Drew"], "Grandma sees her kids by name, not Mom/Dad");

  f.db.prepare(`UPDATE lines SET mode = 'parent' WHERE id = ?`).run(avery);
  assert.equal(syncGrandparentLineModes(f.db), 1, "legacy parent-mode GP row restamped");
  assert.equal(modeOf("Avery"), "grandparent");
  f.db.close();
});

test("Sample families: removing a guardian unlinks their Pod’s grandparents and them", () => {
  const f = buildSampleFamilies();
  const reeseLine = f.id("Reese");
  removeGuardian(f.db, f.casey, f.quinn, f.reese);
  for (const uid of f.users) householdSnapshot(f.db, uid);
  for (const gp of southGps) {
    assert.equal(canCall(f.db, f.quinn, f.id(gp)).ok, false, `Quinn → ${gp}`);
    assert.equal(canCall(f.db, f.id(gp), f.quinn).ok, false, `${gp} → Quinn`);
  }
  assert.equal(canCall(f.db, f.quinn, reeseLine).ok, false);
  assert.equal(canCall(f.db, reeseLine, f.quinn).ok, false);
  assert.equal(canCall(f.db, f.casey, reeseLine).ok, false, "no longer co-parents");
  assert.equal(canCall(f.db, f.quinn, f.id("ChildH")).ok, false, "South cousins go with the Pod");
  assert.equal(canCall(f.db, f.quinn, f.id("Avery")).ok, true, "North grandparents stay");
  const stale = f.db
    .prepare(
      `SELECT COUNT(*) AS n FROM allowlist
       WHERE (household_id = ? AND target_line_id = ?)`
    )
    .get(f.north, reeseLine) as { n: number };
  assert.equal(stale.n, 0, "Reese off the North book");
  f.db.close();
});
