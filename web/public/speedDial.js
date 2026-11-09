/** Pad 0 = TreeHouse. Never a contact slot. */
export const TREEHOUSE_SLOT = 0;
/** Pad 1 = locked child (parent pad) or home parent (kid pad). */
export const ADMIN_PARENT_SLOT = 1;
/** Pad 2 = co-parent when a second parent exists. */
export const SECONDARY_PARENT_SLOT = 2;

/**
 * Stored allowlist speed_dial for a contact tile: 2–9, or null if not on the pad.
 * `Number(null) === 0` must never be treated as TreeHouse / an assigned slot.
 */
export function assignedSpeedDialSlot(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > 9) return null;
  return n;
}

/**
 * Leftover speed_dial 0 or 1 that should be remapped off reserved pads.
 * Null / blank is not a leftover — those contacts stay off the pad.
 */
export function reservedSpeedDialLeftover(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n === TREEHOUSE_SLOT || n === ADMIN_PARENT_SLOT) return n;
  return null;
}

/** Next free speed-dial slot from `min`–9; marks `taken`. */
export function claimSpeedDialSlot(taken, min = 2) {
  for (let s = min; s <= 9; s++) {
    if (!taken.has(s)) {
      taken.add(s);
      return s;
    }
  }
  return null;
}

/**
 * Slot to show for an external (non-household) contact.
 * Unassigned (null) contacts stay off the pad — removing from speed dial PATCHes null.
 */
export function speedDialForExternalContact(entry, opts = {}) {
  const {
    taken,
    contactMin = 2,
    secondaryReserved = false,
    keepAssignedEvenIfTaken = false,
  } = opts;
  const leftover = reservedSpeedDialLeftover(entry?.speed_dial);
  const assigned = assignedSpeedDialSlot(entry?.speed_dial);
  if (leftover != null || (secondaryReserved && assigned === SECONDARY_PARENT_SLOT)) {
    return claimSpeedDialSlot(taken, contactMin);
  }
  if (assigned == null) return null;
  if (assigned < contactMin || assigned > 9) {
    return claimSpeedDialSlot(taken, contactMin);
  }
  if (!taken.has(assigned) || keepAssignedEvenIfTaken) {
    taken.add(assigned);
    return assigned;
  }
  return claimSpeedDialSlot(taken, contactMin);
}

export function withExternalSpeedDial(entry, opts) {
  const speed = speedDialForExternalContact(entry, opts);
  if (speed === entry?.speed_dial) return entry;
  return { ...entry, speed_dial: speed };
}

/**
 * Targets represented by locked/synthetic pad positions before movable contacts
 * receive slots. Parent pads reserve their primary child; kid pads reserve their
 * admin/co-parent lines. The active line is always excluded.
 */
export function reservedPadTargetIds({
  parentPad,
  activeLineId,
  primaryChildId,
  adminParentId,
  secondaryParentId,
} = {}) {
  const ids = new Set();
  if (activeLineId) ids.add(activeLineId);
  if (parentPad) {
    if (primaryChildId) ids.add(primaryChildId);
  } else {
    if (adminParentId) ids.add(adminParentId);
    if (secondaryParentId) ids.add(secondaryParentId);
  }
  return ids;
}

/** One final identity pass after locked/synthetic entries have been inserted. */
export function dedupeSpeedDialTargets(entries) {
  const out = [];
  const indexByTarget = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const target = entry?.target_line_id;
    if (!target) {
      out.push(entry);
      continue;
    }
    const priorIndex = indexByTarget.get(target);
    if (priorIndex == null) {
      indexByTarget.set(target, out.length);
      out.push(entry);
      continue;
    }
    const prior = out[priorIndex];
    if (isLockedSpeedDialContact(entry) && !isLockedSpeedDialContact(prior)) {
      out[priorIndex] = entry;
    }
  }
  return out;
}

/** Synthetic / locked parent-child tiles — not jiggle-deletable. */
export function isLockedSpeedDialContact(entry) {
  if (!entry || typeof entry !== "object") return false;
  const id = String(entry.id || "");
  if (
    id.startsWith("hh-line-") ||
    id.startsWith("hh-home-") ||
    id.startsWith("hh-secondary-") ||
    id.startsWith("gp-preview-") ||
    id.startsWith("gp-kid-")
  ) {
    return true;
  }
  return Boolean(
    entry.household_line ||
      entry.home_parent ||
      entry.home_child ||
      entry.home_grandchild ||
      entry.locked_slot ||
      entry.secondary_parent ||
      entry.gp_preview ||
      entry.gp_split_kid
  );
}

function stripPhoneSuffix(raw) {
  return String(raw || "")
    .replace(/'s phone$/i, "")
    .replace(/\s+phone$/i, "")
    .trim();
}

/** "Alex + Riley" / "Sam & Blake" → separate grandchild names. */
export function splitSharedGrandchildNames(label) {
  const raw = stripPhoneSuffix(label);
  if (!raw) return null;
  const parts = raw
    .split(/\s*(?:\+|\/|&| and )\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^[A-Za-z][A-Za-z.'-]{0,23}$/.test(p))) return null;
  return parts;
}

/** True when this allowlist tile is a provisioned grandparent. */
export function isGrandparentContact(entry) {
  if (!entry) return false;
  if (entry.is_grandparent || entry.grandparents_menu) return true;
  if (entry.kid_label || entry.kid_nickname) return true;
  return false;
}

/**
 * Build digit choices for the kid Grandparents IVR / softphone sheet.
 * Includes off-pad GPs (null speed_dial) so the menu isn’t just the anchor.
 */
export function buildGrandparentMenuChoices(gps) {
  const list = Array.isArray(gps) ? gps : [];
  const byLine = new Map();
  for (const g of list) {
    const lineId = g?.target_line_id || g?.lineId;
    if (!lineId || byLine.has(lineId)) continue;
    const label =
      String(g.kid_label || g.label || "Grandparent").trim() || "Grandparent";
    byLine.set(lineId, {
      lineId,
      label,
      entryId: g.id || g.entryId || null,
    });
  }
  return [...byLine.values()]
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }))
    .map((c, i) => ({ ...c, digit: i + 1 }));
}

/**
 * Kid pad: 1 GP stays a direct tile; 2+ collapse onto the first GP’s key as
 * a single “Grandparents” menu (other GP speed-dials hidden).
 * Pass off-pad GPs (null speed_dial) in `contacts` so they count toward the menu.
 */
export function collapseGrandparentsForKidPad(contacts) {
  const list = Array.isArray(contacts) ? contacts.slice() : [];
  const gps = list
    .filter((c) => c && isGrandparentContact(c) && c.target_line_id)
    .sort((a, b) => {
      const as = assignedSpeedDialSlot(a.speed_dial);
      const bs = assignedSpeedDialSlot(b.speed_dial);
      if (as != null && bs != null && as !== bs) return as - bs;
      if (as != null && bs == null) return -1;
      if (as == null && bs != null) return 1;
      return String(a.created_at || a.id || "").localeCompare(String(b.created_at || b.id || ""));
    });
  const choices = buildGrandparentMenuChoices(gps);

  if (choices.length < 2) {
    // One GP (or none): direct nickname tile. Never leave a stale grandparents_menu
    // flag that would label Avery as “Grandparents” while still data-call-ing her.
    const gpLineIds = new Set(gps.map((g) => g.target_line_id));
    return list
      .filter((c) => {
        if (!c?.target_line_id || !gpLineIds.has(c.target_line_id)) return true;
        return c.speed_dial != null && c.speed_dial !== "";
      })
      .map((c) => {
        if (!isGrandparentContact(c)) return c;
        const kid = String(c.kid_label || "").trim();
        return {
          ...c,
          label: kid || c.label,
          grandparents_menu: undefined,
          menu_choices: undefined,
        };
      });
  }

  const anchor =
    gps.find((g) => assignedSpeedDialSlot(g.speed_dial) != null) ||
    gps.find((g) => g.grandparents_menu) ||
    gps[0];
  const slot = assignedSpeedDialSlot(anchor?.speed_dial);
  if (!anchor || slot == null) {
    return list.filter((c) => !isGrandparentContact(c) || (c.speed_dial != null && c.speed_dial !== ""));
  }

  const menuTile = {
    ...anchor,
    id: anchor.id,
    label: "Grandparents",
    kid_label: "Grandparents",
    speed_dial: slot,
    grandparents_menu: true,
    is_grandparent: true,
    menu_choices: choices,
    favorite: 1,
  };

  const gpLineIds = new Set(gps.map((g) => g.target_line_id));
  const out = list.filter((c) => !c?.target_line_id || !gpLineIds.has(c.target_line_id));
  out.push(menuTile);
  return out;
}

/** Mom / Dad from parent_title; otherwise null. */
export function parentTitlePadLabel(parentTitle) {
  const t = String(parentTitle || "").trim().toLowerCase();
  if (t === "mom") return "Mom";
  if (t === "dad") return "Dad";
  return null;
}

/** Child / shared analog kid — never treat as Mom/Dad or co-parent slot 2. */
export function isGrandparentKidContact(entry) {
  if (!entry) return false;
  if (entry.gp_split_kid || entry.home_grandchild) return true;
  const mode = String(entry.mode || entry.target_mode || "").toLowerCase();
  if (mode === "child") return true;
  return Boolean(splitSharedGrandchildNames(entry.label || entry.child_label));
}

/**
 * Slot-2 allowlist row is a co-parent only when it is not a grandchild.
 * Live bug: analog “Alex + Riley” is stored at speed_dial 2 (server reserves 1),
 * then the pad treated that row as Mom/Dad and dropped the kids.
 */
export function allowlistLooksLikeCoParent(entry) {
  if (!entry?.target_line_id) return false;
  if (Number(entry.speed_dial) !== SECONDARY_PARENT_SLOT) return false;
  if (isGrandparentKidContact(entry)) return false;
  return true;
}

/** Parent-placed speed_dial 2 tile (may be shared kid line, not co-parent). */
export function allowlistSlot2Contact(hh) {
  const allowlist = hh?.allowlist || [];
  return (
    allowlist.find((a) => assignedSpeedDialSlot(a.speed_dial) === SECONDARY_PARENT_SLOT) || null
  );
}

/** True when dial/pad 2 should synthesize Mom/Dad instead of an allowlist contact. */
export function secondaryParentOwnsDial2(hh, secondaryLineId, pad1LineId) {
  if (!secondaryLineId) return false;
  const slot2 = allowlistSlot2Contact(hh);
  if (!slot2?.target_line_id) return true;
  if (slot2.target_line_id === secondaryLineId) return true;
  if (isGrandparentKidContact(slot2)) return false;
  if (pad1LineId && slot2.target_line_id === pad1LineId) return true;
  return false;
}

function grandparentContactKind(entry) {
  const mode = String(entry?.mode || entry?.target_mode || "").toLowerCase();
  if (mode === "child") return "child";
  if (mode === "parent") return "parent";
  if (parentTitlePadLabel(entry?.parent_title || entry?.target_parent_title)) return "parent";
  if (splitSharedGrandchildNames(entry?.label || entry?.child_label)) return "child";
  return "parent";
}

/**
 * Grandparent pad: grandchildren first (shared “Alex + Riley” stays one button), then
 * the adults they may call (their Pod’s parents) by first name — never “Mom/Dad”.
 */
export function grandparentPadEntries(contacts) {
  const kids = (contacts || [])
    .filter((c) => c && c.target_line_id && grandparentContactKind(c) === "child")
    .map((c) => ({
      ...c,
      label: stripPhoneSuffix(c.child_label || c.label) || "Grandchild",
      parent_title: null,
      target_parent_title: null,
      locked_slot: true,
    }));
  kids.sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }));

  const out = [];
  let slot = ADMIN_PARENT_SLOT;
  for (const k of kids) {
    if (slot > 9) break;
    out.push({
      ...k,
      speed_dial: slot,
      home_grandchild: slot === ADMIN_PARENT_SLOT,
      favorite: 1,
      always_allow: k.always_allow ?? 1,
    });
    slot += 1;
  }
  const seen = new Set(out.map((c) => c.target_line_id));
  const adults = (contacts || [])
    .filter((c) => c && c.target_line_id && !seen.has(c.target_line_id))
    .filter((c) => grandparentContactKind(c) !== "child")
    .filter((c) => !c.is_grandparent);
  for (const a of adults) {
    if (slot > 9) break;
    if (seen.has(a.target_line_id)) continue;
    seen.add(a.target_line_id);
    const raw = stripPhoneSuffix(a.label || a.name) || "Family";
    out.push({
      ...a,
      label: parentTitlePadLabel(raw) ? stripPhoneSuffix(a.name) || "Family" : raw,
      parent_title: null,
      target_parent_title: null,
      speed_dial: slot,
      favorite: 1,
      always_allow: a.always_allow ?? 0,
    });
    slot += 1;
  }
  return out;
}
