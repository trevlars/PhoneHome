const MANAGED_RELATIVE_PREFIX = "managed-relative:";

export function managedRelativePickerValue(relativeId) {
  return relativeId ? `${MANAGED_RELATIVE_PREFIX}${relativeId}` : "";
}

export function managedRelativeIdFromPickerValue(value) {
  const raw = String(value || "");
  return raw.startsWith(MANAGED_RELATIVE_PREFIX)
    ? raw.slice(MANAGED_RELATIVE_PREFIX.length)
    : null;
}

export function profilePickerSelection(value) {
  const relativeId = managedRelativeIdFromPickerValue(value);
  if (relativeId) {
    return { kind: "managed-relative-preview", relativeId };
  }
  const lineId = String(value || "");
  return lineId ? { kind: "line", lineId } : { kind: "none" };
}

/**
 * Provisioned relatives whose phones are managed through preview, not claimed as
 * the signed-in parent's active line. Relatives already represented by a visible
 * household line (merged grandparents) stay in the normal line list.
 */
export function managedRelativePickerEntries(lines, households) {
  const representedLineIds = new Set(
    (Array.isArray(lines) ? lines : []).map((line) => line?.id).filter(Boolean)
  );
  const seenRelativeIds = new Set();
  const entries = [];
  for (const household of Array.isArray(households) ? households : []) {
    for (const relative of household?.provisioned_relatives || []) {
      if (!relative?.id || seenRelativeIds.has(relative.id)) continue;
      seenRelativeIds.add(relative.id);
      if (relative.line_id && representedLineIds.has(relative.line_id)) continue;
      const name =
        String(relative.display_name || relative.display_label || "Relative").trim() ||
        "Relative";
      entries.push({
        kind: "managed-relative",
        relativeId: relative.id,
        lineId: relative.line_id || null,
        householdId: household.id || null,
        value: managedRelativePickerValue(relative.id),
        label: `${name} · managed grandparent settings`,
      });
    }
  }
  return entries;
}
