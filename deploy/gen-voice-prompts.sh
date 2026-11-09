#!/usr/bin/env bash
#
# Render PhoneHome's spoken prompts with Piper (local neural TTS) into
# bridged/sounds/ as 8 kHz mono telephony audio.
#
# WHY PIPER AND NOT FLITE
# -----------------------
# app_flite's best voice (slt) is a 2005 diphone synth and sounds robotic on an
# 8 kHz handset. Piper is neural and runs entirely on our own hardware, which
# matters: a cloud TTS would ship kids' contact names to a third party on every
# call. See docs/privacy-security.md.
#
# WHY PRE-RENDER
# --------------
# Synthesizing during a call puts TTS latency in the audio path and makes the
# announcement depend on the PBX having a working app_flite. These clips are
# generated once, committed, and simply played. Per-contact "Call from {name}"
# clips are rendered by the server when a contact is added or renamed.
#
# Piper lives on the PhoneHome container (CT 122); rendering happens there and
# the WAVs are pulled back into the repo.
#
# Usage:
#   ./deploy/gen-voice-prompts.sh              # render everything with amy
#   VOICE=lessac ./deploy/gen-voice-prompts.sh # try a different voice
#   KEEP_REMOTE=1 ./deploy/gen-voice-prompts.sh
#
# Install Piper + voices on CT 122 first (one time):
#   see docs/ht801-lab.md -> "Voice prompts"

set -euo pipefail

VOICE="${VOICE:-amy}"
PVE="${PVE:-}"
PH_CT="${PH_CT:-}"
if [[ -z "$PVE" || -z "$PH_CT" ]]; then
  echo "Set PVE and PH_CT. Example: PVE=root@192.168.1.2 PH_CT=201 $0" >&2
  exit 1
fi
PIPER_DIR="${PIPER_DIR:-/opt/piper}"
KEEP_REMOTE="${KEEP_REMOTE:-0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/bridged/sounds"
MODEL="$PIPER_DIR/voices/en_US-${VOICE}-medium.onnx"

# name<TAB>text. Keep wording in sync with:
#   server/src/unavailableVoice.ts   (UNAVAILABLE_SPOKEN, callee side)
#   bridged/src/vm-ivr.mjs           (menu prompts)
read -r -d '' PROMPTS <<'MANIFEST' || true
unavailable-timeout	They're in a timeout right now. Please try again later.
unavailable-bedtime	They're not available until tomorrow. Please try again then.
unavailable-school	They're at school right now. Please try again later.
unavailable-quiet	They're in Quiet Time right now. Please try again later.
unavailable-paused	They're in a timeout right now. Please try again later.
unavailable-cap	Their talk time for today is full. Please try again tomorrow.
unavailable-allowlist	You're not on their approved contacts.
unavailable-self	You can't call your own line.
unavailable-unknown	They're not available right now. Please try again later.
menu-main	Press 1 for messages. Press 2 for greetings.
menu-greeting	Press 1 to record your greeting. Press 2 to play it. Press 3 to clear it.
menu-review	Press 1 to save. Press 2 to listen. Press 3 to re-record.
menu-message	Press 4 to replay. Press 7 to delete. Press 9 to keep.
msgs-none	You have no messages.
msgs-one	You have one new message.
msgs-2	You have 2 new messages.
msgs-3	You have 3 new messages.
msgs-4	You have 4 new messages.
msgs-5	You have 5 new messages.
msgs-6	You have 6 new messages.
msgs-7	You have 7 new messages.
msgs-8	You have 8 new messages.
msgs-9	You have 9 new messages.
msgs-many	You have several new messages.
msgs-heard-one	You have one message.
msgs-heard-many	You have several messages.
call-from	Call from
calling	Calling
record-after-tone	Please record your message after the tone.
record-greeting	Record your greeting after the beep. Press pound when finished.
greeting-saved	Greeting saved.
greeting-cleared	Greeting cleared.
no-greeting	There is no custom greeting. Using the default.
sorry	Sorry.
sorry-play	Sorry. Could not play the greeting.
sorry-record	Sorry. Could not record.
sorry-save	Sorry. Could not save.
sorry-load	Sorry. Could not load messages.
sorry-play-msg	Sorry. Could not play that message.
message-deleted	Message deleted.
no-more-messages	No more messages.
goodbye	Goodbye.
playing-messages	Playing your messages.
MANIFEST

echo "Rendering PhoneHome prompts"
echo "  voice : en_US-${VOICE}-medium"
echo "  piper : $PVE -> CT $PH_CT:$PIPER_DIR"
echo "  out   : $OUT_DIR"
echo

if ! ssh "$PVE" "pct exec $PH_CT -- test -f $MODEL"; then
  echo "error: voice model not found at $MODEL on CT $PH_CT" >&2
  echo "       download it, e.g.:" >&2
  echo "       curl -sSL -o $MODEL https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/${VOICE}/medium/en_US-${VOICE}-medium.onnx" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
REMOTE_OUT="$PIPER_DIR/out/prompts"
ssh "$PVE" "pct exec $PH_CT -- bash -lc 'rm -rf $REMOTE_OUT && mkdir -p $REMOTE_OUT'"

count=0
while IFS=$'\t' read -r name text; do
  [ -z "${name:-}" ] && continue
  case "$name" in \#*) continue ;; esac

  # Text goes to piper on stdin so quoting/apostrophes stay intact.
  # 8 kHz mono 16-bit PCM is what Asterisk plays on the FXS leg.
  ssh "$PVE" "pct exec $PH_CT -- bash -lc '
    cd $PIPER_DIR
    cat > /tmp/.ph-tts.txt
    ./piper/piper -m $MODEL -f /tmp/.ph-raw.wav < /tmp/.ph-tts.txt 2>/dev/null
    ffmpeg -y -loglevel error -i /tmp/.ph-raw.wav -ac 1 -ar 8000 -c:a pcm_s16le $REMOTE_OUT/$name.wav
    ffmpeg -y -loglevel error -i $REMOTE_OUT/$name.wav -ar 8000 -ac 1 -f mulaw $REMOTE_OUT/$name.ulaw
    rm -f /tmp/.ph-tts.txt /tmp/.ph-raw.wav
  '" <<<"$text"

  printf '  %-24s %s\n' "$name" "$(echo "$text" | cut -c1-46)"
  count=$((count + 1))
done <<<"$PROMPTS"

echo
echo "Rendered $count prompts. Pulling into repo…"
TMP="$(mktemp -d)"
ssh "$PVE" "pct exec $PH_CT -- tar -cf - -C $REMOTE_OUT ." > "$TMP/prompts.tar"
tar -xf "$TMP/prompts.tar" -C "$OUT_DIR"
rm -rf "$TMP"

if [ "$KEEP_REMOTE" != "1" ]; then
  ssh "$PVE" "pct exec $PH_CT -- rm -rf $REMOTE_OUT"
fi

echo
ls -la "$OUT_DIR" | tail -n +2
echo
echo "Done. Deploy with ./deploy/proxmox-rsync.sh so FreePBX/bridged pick them up."
