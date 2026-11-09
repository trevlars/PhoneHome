import Stripe from "stripe";
import {
  activateHostLicenseRow,
  createHostLicenseCheckoutRow,
  createInstance,
  ensureOrganization,
  hostReferrerByCode,
  latestHostLicenseForInstance,
  listOrganizationInstanceIds,
  organizationForCustomer,
  recordReferralRedemption,
  recordStripeEvent,
  referralAlreadyRedeemed,
  setInstanceEntitlements,
  stripeEventProcessed,
  upsertHostReferrer,
  upsertSubscription,
  type ControlDb,
} from "./db.js";
import {
  hostLicenseAnnualPriceId,
  hostLicensePrivateKey,
  isHostLicensePrice,
  issueAnnualLicensePayload,
  referralCreditCents,
  signHostLicense,
  spinoffPromoCode,
} from "./hostLicenseSign.js";
import { planForPrice } from "./plans.js";
import { dispatchProvisioning } from "./provisioner.js";

const SELLER = String(process.env.PHONEHOME_SELLER_NAME || "the operator").trim() || "the operator";

export function stripeClient(): Stripe {
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

export async function createCheckoutSession(
  stripe: Stripe,
  opts: { email: string; priceId: string; instanceName?: string }
): Promise<string> {
  if (!planForPrice(opts.priceId)) throw new Error("Unknown plan");
  const successUrl = String(process.env.STRIPE_SUCCESS_URL || "").trim();
  const cancelUrl = String(process.env.STRIPE_CANCEL_URL || "").trim();
  if (!successUrl || !cancelUrl) throw new Error("Stripe return URLs are not configured");
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    // Cards (+ Apple/Google Pay). No Klarna / Affirm / Afterpay / other BNPL.
    payment_method_types: ["card"],
    customer_email: opts.email.trim().toLowerCase(),
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    custom_text: {
      submit: {
        message:
          `Sold by ${SELLER}. You are purchasing a managed PhoneHome Mothership subscription.`,
      },
    },
    metadata: {
      instance_name: String(opts.instanceName || "Family Mothership").trim().slice(0, 80),
      sku: "managed_mothership",
      seller_of_record: SELLER,
    },
    subscription_data: {
      description: `PhoneHome managed Mothership — ${SELLER}`,
      metadata: {
        sku: "managed_mothership",
        seller_of_record: SELLER,
      },
    },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** Self-host $25/year — signs a local mothership license (no VPS provisioning). */
export async function createHostLicenseCheckout(
  db: ControlDb,
  stripe: Stripe,
  opts: {
    email: string;
    instanceId: string;
    promoCode?: string;
    referralCode?: string;
    source?: string;
  }
): Promise<string> {
  const priceId = hostLicenseAnnualPriceId();
  if (!priceId) throw new Error("STRIPE_PRICE_HOST_ANNUAL is not configured");
  if (!hostLicensePrivateKey()) throw new Error("HOST_LICENSE_PRIVATE_KEY is not configured");
  const instanceId = opts.instanceId.trim();
  if (!/^phinst_[a-f0-9]{16,}$/i.test(instanceId) && instanceId !== "*") {
    throw new Error("Valid mothership instance id required (phinst_…)");
  }
  const successUrl = String(
    process.env.HOST_LICENSE_SUCCESS_URL || process.env.STRIPE_SUCCESS_URL || ""
  ).trim();
  const cancelUrl = String(
    process.env.HOST_LICENSE_CANCEL_URL || process.env.STRIPE_CANCEL_URL || ""
  ).trim();
  if (!successUrl || !cancelUrl) throw new Error("Host license Stripe return URLs are not configured");
  const email = opts.email.trim().toLowerCase();
  const source = String(opts.source || "").trim().toLowerCase();
  const referralCode = String(opts.referralCode || "")
    .trim()
    .toUpperCase();
  let promoCode = String(opts.promoCode || "")
    .trim()
    .toUpperCase();
  if (!promoCode && (source === "spinoff" || referralCode)) {
    promoCode = spinoffPromoCode();
  }

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl.includes("{CHECKOUT_SESSION_ID}")
      ? successUrl
      : `${successUrl}${successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    custom_text: {
      submit: {
        message: promoCode
          ? `Sold by ${SELLER}. First year $20 with ${promoCode} ($5 off) — then $25/year.`
          : `Sold by ${SELLER}. Flat $25/year — you are purchasing an annual PhoneHome Mothership host license.`,
      },
      after_submit: {
        message:
          `Receipt and license key are issued by ${SELLER} for PhoneHome. Paste the key on your Mothership to activate.`,
      },
    },
    metadata: {
      sku: "host_license",
      mothership_instance_id: instanceId,
      seller_of_record: SELLER,
      pricing: promoCode ? "spinoff_20" : "flat_25",
      ...(referralCode ? { referral_code: referralCode } : {}),
      ...(source ? { source } : {}),
    },
    subscription_data: {
      description: promoCode
        ? `PhoneHome host license — first year promo ${promoCode}`
        : `PhoneHome Mothership host license — $25/year flat — ${SELLER}`,
      metadata: {
        sku: "host_license",
        mothership_instance_id: instanceId,
        seller_of_record: SELLER,
        ...(referralCode ? { referral_code: referralCode } : {}),
      },
    },
  };

  if (promoCode) {
    const promos = await stripe.promotionCodes.list({ code: promoCode, active: true, limit: 1 });
    const promo = promos.data[0];
    if (!promo) {
      throw new Error(
        `Promotion code ${promoCode} is not available. Try again without a promo, or use OWNMS5 from the spinoff offer.`
      );
    }
    sessionParams.discounts = [{ promotion_code: promo.id }];
    // Can't combine allow_promotion_codes with discounts in some API versions — prefer applied discount.
    delete sessionParams.allow_promotion_codes;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  if (!session.url || !session.id) throw new Error("Stripe did not return a checkout URL");
  createHostLicenseCheckoutRow(db, {
    mothershipInstanceId: instanceId,
    ownerEmail: email,
    stripeCheckoutSessionId: session.id,
  });
  return session.url;
}

function issueSignedHostLicense(
  db: ControlDb,
  opts: {
    checkoutSessionId: string;
    instanceId: string;
    email: string;
    customerId: string;
    subscriptionId: string | null;
    referralCodeForLicense?: string;
  }
): { blob: string; referralCode: string } {
  const pem = hostLicensePrivateKey();
  if (!pem) throw new Error("HOST_LICENSE_PRIVATE_KEY is not configured");
  const prior = latestHostLicenseForInstance(db, opts.instanceId);
  const extendFromExpMs = prior?.expires_at ? Date.parse(prior.expires_at) : null;
  const referrer = upsertHostReferrer(db, {
    mothershipInstanceId: opts.instanceId,
    stripeCustomerId: opts.customerId,
    ownerEmail: opts.email,
  });
  const payload = issueAnnualLicensePayload({
    instanceId: opts.instanceId,
    email: opts.email,
    referralCode: referrer.referral_code,
    extendFromExpMs: Number.isFinite(extendFromExpMs) ? extendFromExpMs : null,
  });
  const blob = signHostLicense(payload, pem);
  activateHostLicenseRow(db, {
    checkoutSessionId: opts.checkoutSessionId,
    stripeCustomerId: opts.customerId,
    stripeSubscriptionId: opts.subscriptionId,
    licenseBlob: blob,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  });
  return { blob, referralCode: referrer.referral_code };
}

async function maybeCreditReferrer(
  db: ControlDb,
  stripe: Stripe,
  opts: {
    referredInstanceId: string;
    referredCustomerId: string;
    referredEmail: string;
    referralCode: string;
    checkoutSessionId: string;
  }
): Promise<void> {
  const code = opts.referralCode.trim().toUpperCase();
  if (!code || opts.referredInstanceId === "*") return;
  if (referralAlreadyRedeemed(db, opts.referredInstanceId)) return;
  const referrer = hostReferrerByCode(db, code);
  if (!referrer) return;
  if (referrer.mothership_instance_id === opts.referredInstanceId) return;
  if (referrer.stripe_customer_id === opts.referredCustomerId) return;
  if (referrer.owner_email === opts.referredEmail.toLowerCase()) return;
  const cents = referralCreditCents();
  try {
    await stripe.customers.createBalanceTransaction(referrer.stripe_customer_id, {
      amount: -cents,
      currency: "usd",
      description: `PhoneHome referral — new Mothership ${opts.referredInstanceId.slice(0, 18)}…`,
      metadata: {
        phonehome_offer: "host_referral_credit",
        referred_instance_id: opts.referredInstanceId,
        referrer_code: code,
      },
    });
  } catch (err) {
    console.error("[referral] Stripe credit failed — not recording redemption", err);
    return;
  }
  if (!recordReferralRedemption(db, {
    referredInstanceId: opts.referredInstanceId,
    referrerCode: code,
    checkoutSessionId: opts.checkoutSessionId,
    creditedCents: cents,
  })) {
    console.warn("[referral] credited Stripe but redemption row already existed", opts.referredInstanceId);
  }
}

function customerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string {
  return typeof value === "string" ? value : value?.id || "";
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): string | null {
  const raw = subscription as unknown as { current_period_end?: number };
  return raw.current_period_end
    ? new Date(raw.current_period_end * 1000).toISOString()
    : null;
}

async function syncSubscription(
  db: ControlDb,
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<void> {
  const customer = customerId(subscription.customer);
  const organizationId = organizationForCustomer(db, customer);
  if (!organizationId) throw new Error(`No organization for Stripe customer ${customer}`);
  const priceId = subscription.items.data[0]?.price.id || "";
  const plan = planForPrice(priceId);
  if (!plan) throw new Error(`No entitlement plan for Stripe price ${priceId}`);
  upsertSubscription(db, {
    organizationId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    status: subscription.status,
    currentPeriodEnd: subscriptionPeriodEnd(subscription),
  });
  for (const instanceId of listOrganizationInstanceIds(db, organizationId)) {
    setInstanceEntitlements(db, instanceId, {
      ...plan,
      iosPush: !["unpaid", "canceled", "incomplete_expired"].includes(subscription.status),
    });
  }
  // Ensure a customer portal can be opened even when webhook order races.
  await stripe.customers.retrieve(customer);
}

export async function processStripeEvent(
  db: ControlDb,
  stripe: Stripe,
  event: Stripe.Event
): Promise<boolean> {
  if (stripeEventProcessed(db, event.id)) return false;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const customer = customerId(session.customer);
    const email = session.customer_details?.email || session.customer_email || "";
    if (!customer || !email) throw new Error("Completed checkout is missing customer details");
    const sku = String(session.metadata?.sku || "");
    const hostInstanceId = String(session.metadata?.mothership_instance_id || "").trim();
    if (sku === "host_license" || hostInstanceId.startsWith("phinst_")) {
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id || null;
      let priceId = "";
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        priceId = subscription.items.data[0]?.price.id || "";
      }
      if (priceId && !isHostLicensePrice(priceId) && sku !== "host_license") {
        // Fall through to managed path if price is a managed plan.
      } else {
        if (!hostInstanceId) throw new Error("Host license checkout missing mothership_instance_id");
        issueSignedHostLicense(db, {
          checkoutSessionId: session.id,
          instanceId: hostInstanceId,
          email,
          customerId: customer,
          subscriptionId,
        });
        const refCode = String(session.metadata?.referral_code || "").trim();
        if (refCode) {
          await maybeCreditReferrer(db, stripe, {
            referredInstanceId: hostInstanceId,
            referredCustomerId: customer,
            referredEmail: email,
            referralCode: refCode,
            checkoutSessionId: session.id,
          });
        }
        ensureOrganization(db, { stripeCustomerId: customer, ownerEmail: email });
        recordStripeEvent(db, event.id, event.type);
        return true;
      }
    }
    const organizationId = ensureOrganization(db, { stripeCustomerId: customer, ownerEmail: email });
    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(
        typeof session.subscription === "string" ? session.subscription : session.subscription.id
      );
      await syncSubscription(db, stripe, subscription);
      const priceId = subscription.items.data[0]?.price.id || "";
      if (isHostLicensePrice(priceId)) {
        const instanceId = String(session.metadata?.mothership_instance_id || "").trim();
        if (instanceId) {
          issueSignedHostLicense(db, {
            checkoutSessionId: session.id,
            instanceId,
            email,
            customerId: customer,
            subscriptionId: subscription.id,
          });
          const refCode = String(session.metadata?.referral_code || "").trim();
          if (refCode) {
            await maybeCreditReferrer(db, stripe, {
              referredInstanceId: instanceId,
              referredCustomerId: customer,
              referredEmail: email,
              referralCode: refCode,
              checkoutSessionId: session.id,
            });
          }
        }
        recordStripeEvent(db, event.id, event.type);
        return true;
      }
      const plan = planForPrice(priceId);
      if (!plan) throw new Error(`No entitlement plan for Stripe price ${priceId}`);
      if (!listOrganizationInstanceIds(db, organizationId).length) {
        const name = String(session.metadata?.instance_name || "Family Mothership");
        const instance = createInstance(db, { organizationId, name });
        setInstanceEntitlements(db, instance.id, plan);
        await dispatchProvisioning({
          instanceId: instance.id,
          instanceSecret: instance.secret,
          name,
          plan,
        });
      }
    }
  } else if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await syncSubscription(db, stripe, event.data.object as Stripe.Subscription);
  } else if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const parent = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof parent === "string" ? parent : parent?.id;
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncSubscription(db, stripe, subscription);
    }
  } else if (event.type === "invoice.paid") {
    const invoice = event.data.object as Stripe.Invoice;
    // First year is issued on checkout.session.completed; renewals only here.
    if (invoice.billing_reason === "subscription_create") {
      /* skip */
    } else {
      const parent = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof parent === "string" ? parent : parent?.id;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price.id || "";
        if (isHostLicensePrice(priceId)) {
          const instanceId = String(subscription.metadata?.mothership_instance_id || "").trim();
          const customer = customerId(subscription.customer);
          const email =
            (await stripe.customers.retrieve(customer).then((c) =>
              !("deleted" in c) && c.email ? c.email : ""
            )) || "";
          if (instanceId && email && customer) {
            const syntheticSession = `renew_${subscription.id}_${invoice.id}`;
            createHostLicenseCheckoutRow(db, {
              mothershipInstanceId: instanceId,
              ownerEmail: email,
              stripeCheckoutSessionId: syntheticSession,
            });
            issueSignedHostLicense(db, {
              checkoutSessionId: syntheticSession,
              instanceId,
              email,
              customerId: customer,
              subscriptionId: subscription.id,
            });
          }
        } else {
          await syncSubscription(db, stripe, subscription);
        }
      }
    }
  }
  recordStripeEvent(db, event.id, event.type);
  return true;
}
