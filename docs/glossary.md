# PhoneHome glossary

**PhoneHome** is the product — the app, the brand, the family voice network.

These terms help parents and hosts talk about how it works without sounding like a server manual.

## Mothership

The **always-on PhoneHome server** for your circle — one per circle.

- Runs on a home PC, Mac, Linux box, Pi, or lab VM.
- Holds households, invites, allowlists, and signaling (not call audio for softphones).
- Cousins connect to **your** Mothership with your HTTPS URL + invite code.

> “We run the Mothership on an old Mac in the closet. Grandma joins with our link.”

Technical names (`kids-landline.service`, `DATA_DIR`, env files) stay in deploy docs — **Mothership** is the friendly label in UI and parent copy.

## Circle

Everyone who shares one Mothership — your household plus invited families on the same server.

**One Mothership per circle.** A second circle needs a second Mothership (another host).

## Leaves

Phones on the network — softphones today; analog handsets (HT801), Bluetooth, or Home Hub hardware later. They register **to** the Mothership; they are not the Mothership.

## TreeHouse / FamilyRoom

In-app voice spaces (pad **0** and **#**). Not separate servers — features on the same Mothership.

## Trunk (technical)

Engineering/docs term for the signaling server. Same thing as **Mothership**; we prefer **Mothership** in parent-facing copy.

## Federation (future)

Two circles, two Motherships, trusted peering — see [`family-mesh.md`](./family-mesh.md) Stage 3.

## Related

| Doc | Topic |
| --- | --- |
| [`self-host.md`](./self-host.md) | Run your own Mothership |
| [`family-mesh.md`](./family-mesh.md) | Invites, circles, federation |
| [`privacy-security.md`](./privacy-security.md) | Encryption pillar |
