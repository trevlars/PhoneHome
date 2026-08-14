# Family mesh / invites (Stage 1 + future)

## Stage 1 (one trunk) — shipped

Minecraft model: one `kids-landline` server; all softphones are clients.

1. Parent A creates invite → 6-digit code (48h, single-use).  
2. Parent B redeems → new household on **same** server.  
3. Both allowlist lines.  
4. Call: WebRTC offer via `/ws`; STUN; media peer-to-peer.  
5. **No VPN** for Parent B.

Peer server table `peer_servers` is reserved for Stage 3 federation.

## Stage 3 — trunk↔trunk (planned)

```
Household A tree                Household B tree
leaves → Trunk A  ←invite peer→  Trunk B ← leaves
              \                    /
               WebRTC leaf↔leaf when possible
```

1. Invite encodes trust material + signaling URL (via outbound tunnel / DDNS).  
2. Mutual TLS / pinned keys in `peer_servers`.  
3. Cross-allowlist still enforced on each trunk.  
4. TURN only if ICE fails.  
5. Optional connectivity helper = intro + TURN only — not household DB.

## Parent copy

“Invite family” / “Accept invite” — never “join VPN” or “port forward.”
