# Parental listen-in

**Status:** TreeHouse **listen-only** is shipping (softphone + analog FXS mix). Classic 1:1 parallel-pickup listen-in remains a later path.

**Privacy pillar:** Any listen-in design must satisfy [`privacy-security.md`](./privacy-security.md) — audited, household-policy, never silent adult spyware, no call-audio archive by default. Legal review before broader 1:1 listen-in.

## TreeHouse listen-only (shipped)

- Parent-only, same household; toggle in **Parent → TreeHouse**.
- Receive-only WebRTC: parent hears the **child’s filtered mix** (same talk peers the child hears), not a secret full-room god mix.
- Analog kid: parent hears that child’s **Circle-filtered** FXS TreeHouse mix (recvonly ExternalMedia on the child’s hear-bridge). Softphone talk peers still mesh separately.
- **Never silent:** on start, TTS to **everyone currently in TreeHouse**: “{Child}’s parent is listening”. Analog mix gets the same Flite phrase. Pad shows a distinct parent-listening chip.
- Does not inject parent mic. Stop listening leaves without endangering kid mesh.
- No call content logged — only presence / listen start-stop style metadata in server logs (`[treehouse] listen start …`).

## Future: 1:1 parallel pickup (not Stage 1)

Landline-style join of a child’s active **1:1** call as receive-only. Still requires child mode, live call visibility, and parent PIN gating before design/ship. Constraints from the original sketch still apply: parent-only, PIN-gated, never exposed across families, audit trail, consent framing.

## Related

- [`family-mesh.md`](./family-mesh.md) — TreeHouse model
- [`threat-model.md`](./threat-model.md) — silent surveillance threat row
