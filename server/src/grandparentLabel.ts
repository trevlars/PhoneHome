import type Database from "better-sqlite3";

export type GrandparentHonorific = "Grandma" | "Grandpa";

function stripPhoneSuffix(raw: string): string {
  return String(raw || "")
    .replace(/'s phone$/i, "")
    .replace(/\s+phone$/i, "")
    .trim();
}

/** Grandma vs Grandpa from name, label, or username (e.g. grandmanorth). */
export function inferGrandparentHonorific(
  ...hints: Array<string | null | undefined>
): GrandparentHonorific {
  const blob = hints
    .map((h) => String(h || "").replace(/[_-]+/g, " "))
    .join(" ")
    .trim();
  const compact = blob.replace(/\s+/g, "").toLowerCase();
  if (
    /grandpa|grandfather|granddad|granddaddy|papaw|pawpaw|poppop|grampa|gramps|grandpak/.test(
      compact
    )
  ) {
    return "Grandpa";
  }
  if (/\b(papa|dad|daddy|father)\b/i.test(blob)) return "Grandpa";
  if (/grandma|grandmother|\bnana\b|mamaw|meemaw|grammy|grammie|granny|grandmak/.test(compact)) {
    return "Grandma";
  }
  if (/\b(nana|mom|mommy|mother)\b/i.test(blob)) return "Grandma";
  return "Grandma";
}

/** Saved nickname or Grandma/Grandpa. Blank is not allowed. */
export function normalizeKidNickname(
  raw: string | null | undefined,
  fallback: GrandparentHonorific = "Grandma"
): string {
  const s = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  return s || fallback;
}

/** Kids see “Meemaw North” / “Grandpa East” — nickname + Pod family name. */
export function kidFacingGrandparentLabel(
  podName: string,
  nickname?: string | null,
  ...hints: Array<string | null | undefined>
): string {
  const honorific = inferGrandparentHonorific(...hints);
  const nick = normalizeKidNickname(nickname, honorific);
  const pod = String(podName || "").trim() || "Family";
  return `${nick} ${pod}`;
}

function isHonorificStyleName(name: string): boolean {
  return /^(grandma|grandpa|grandparent|nana|papa)(\s+\S+)?$/i.test(String(name || "").trim());
}

function titleCaseUsername(username?: string | null): string {
  const s = String(username || "").trim();
  if (!s || /^(grandma|grandpa|nana)/i.test(s)) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Adults see the real name (Sloan/Parker/Avery), never “Grandma East”. */
export function adultFacingGrandparentLabel(
  displayName?: string | null,
  displayLabel?: string | null,
  username?: string | null
): string {
  const named = stripPhoneSuffix(displayName || "");
  if (named && !isHonorificStyleName(named)) return named;
  const labeled = stripPhoneSuffix(displayLabel || "");
  if (labeled && !isHonorificStyleName(labeled)) return labeled;
  const fromUser = titleCaseUsername(username);
  if (fromUser) return fromUser;
  return named || labeled || "Grandparent";
}

export function grandparentLabelsFromHints(opts: {
  podName?: string | null;
  displayName?: string | null;
  displayLabel?: string | null;
  username?: string | null;
  kidNickname?: string | null;
}): { kid: string; adult: string; honorific: GrandparentHonorific; nickname: string } {
  const honorific = inferGrandparentHonorific(opts.displayName, opts.displayLabel, opts.username);
  const nickname = normalizeKidNickname(opts.kidNickname, honorific);
  return {
    honorific,
    nickname,
    kid: kidFacingGrandparentLabel(
      opts.podName || "Family",
      nickname,
      opts.displayName,
      opts.displayLabel,
      opts.username
    ),
    adult: adultFacingGrandparentLabel(opts.displayName, opts.displayLabel, opts.username),
  };
}

/** Pad/CID labels for a provisioned grandparent line, or null if they are not one. */
export function lookupGrandparentPadLabels(
  db: Database.Database,
  lineId: string
): { kid: string; adult: string; honorific: GrandparentHonorific; nickname: string } | null {
  if (!lineId) return null;
  const row = db
    .prepare(
      `SELECT pr.display_label, pr.kid_nickname, u.display_name, u.username, h.name AS pod_name
       FROM provisioned_relatives pr
       JOIN users u ON u.id = pr.relative_user_id
       JOIN households h ON h.id = pr.from_household_id
       WHERE pr.relative_line_id = ?
       LIMIT 1`
    )
    .get(lineId) as
    | {
        display_label: string | null;
        kid_nickname: string | null;
        display_name: string;
        username: string | null;
        pod_name: string;
      }
    | undefined;
  if (!row) return null;
  return grandparentLabelsFromHints({
    podName: row.pod_name,
    displayName: row.display_name,
    displayLabel: row.display_label,
    username: row.username,
    kidNickname: row.kid_nickname,
  });
}
