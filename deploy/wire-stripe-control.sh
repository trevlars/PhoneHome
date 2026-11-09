#!/usr/bin/env bash
# Wire Stripe test (or live) keys into lab control.env and restart.
#
# Usage:
#   STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... \
#     ./deploy/wire-stripe-control.sh
#
# Or interactive: paste when prompted.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PVE="${PVE_HOST:-}"
CTID="${CONTROL_CTID:-}"
if [[ -z "$PVE" || -z "$CTID" ]]; then
  echo "Set PVE_HOST and CONTROL_CTID. Example: PVE_HOST=root@192.168.1.2 CONTROL_CTID=201 $0" >&2
  exit 1
fi
DATA_DIR="/var/lib/phonehome-control"

if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  echo -n "Paste STRIPE_SECRET_KEY (sk_test_…): "
  read -r STRIPE_SECRET_KEY
fi
if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
  echo "STRIPE_SECRET_KEY required" >&2
  exit 1
fi

echo "==> Ensure \$20/year host-license price exists"
PRICE_LINE="$(
  cd "$ROOT" && STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY" node control/scripts/create-host-license-price.mjs
)"
echo "$PRICE_LINE"
PRICE_ID="$(echo "$PRICE_LINE" | awk -F= '/^STRIPE_PRICE_HOST_ANNUAL=/{print $2}')"
[[ -n "$PRICE_ID" ]] || { echo "Failed to create/find price" >&2; exit 1; }

if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
  echo
  echo "Webhook (needed so paid checkouts auto-sign licenses):"
  echo "  1. https://dashboard.stripe.com/test/webhooks  (Test mode)"
  echo "  2. Add endpoint → URL:"
  echo "       https://mothership.example:8443/v1/webhooks/stripe"
  echo "  3. Events: checkout.session.completed, customer.subscription.updated,"
  echo "             customer.subscription.deleted, invoice.paid"
  echo "  4. Reveal signing secret (whsec_…)"
  echo -n "Paste STRIPE_WEBHOOK_SECRET (or Enter to skip for now): "
  read -r STRIPE_WEBHOOK_SECRET || true
fi

echo "==> Writing control.env on CT ${CTID}"
# Escape for remote sed — write via a temp env snippet
TMP="$(mktemp)"
{
  echo "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}"
  echo "STRIPE_PRICE_HOST_ANNUAL=${PRICE_ID}"
  [[ -n "${STRIPE_WEBHOOK_SECRET:-}" ]] && echo "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}"
} >"$TMP"
scp -q "$TMP" "$PVE:/tmp/stripe-snippet.env"
rm -f "$TMP"

ssh "$PVE" "pct push ${CTID} /tmp/stripe-snippet.env /tmp/stripe-snippet.env && pct exec ${CTID} -- bash -lc '
set -euo pipefail
ENV=${DATA_DIR}/control.env
# Drop old Stripe lines
grep -vE \"^(STRIPE_SECRET_KEY|STRIPE_PRICE_HOST_ANNUAL|STRIPE_WEBHOOK_SECRET)=\" \"\$ENV\" > \"\$ENV.tmp\" || true
cat /tmp/stripe-snippet.env >> \"\$ENV.tmp\"
mv \"\$ENV.tmp\" \"\$ENV\"
chmod 600 \"\$ENV\"
systemctl restart phonehome-control
sleep 1
curl -sf http://127.0.0.1:8791/v1/host-license/product
echo
'"

echo
echo "Done. checkout_ready should be true above."
echo "Test buy: https://mothership.example:8443/buy.html"
echo "Card in test mode: 4242 4242 4242 4242 · any future expiry · any CVC"
