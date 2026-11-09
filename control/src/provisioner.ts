import crypto from "node:crypto";
import type { PlanEntitlements } from "./plans.js";

export async function dispatchProvisioning(input: {
  instanceId: string;
  instanceSecret: string;
  name: string;
  plan: PlanEntitlements;
}): Promise<void> {
  const url = String(process.env.PROVISIONER_WEBHOOK_URL || "").trim();
  const secret = String(process.env.PROVISIONER_WEBHOOK_SECRET || "");
  if (!url) {
    console.warn(`[control] provisioner not configured; instance=${input.instanceId} remains pending`);
    return;
  }
  if (!/^https:\/\//i.test(url) && process.env.NODE_ENV === "production") {
    throw new Error("PROVISIONER_WEBHOOK_URL must use HTTPS in production");
  }
  if (secret.length < 24) throw new Error("PROVISIONER_WEBHOOK_SECRET is too short");
  const body = JSON.stringify({
    instance_id: input.instanceId,
    instance_secret: input.instanceSecret,
    name: input.name,
    plan: input.plan.plan,
    limits: {
      max_pods: input.plan.maxPods,
      warn_pods: input.plan.warnPods,
      max_lines: input.plan.maxLines,
      warn_lines: input.plan.warnLines,
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-phonehome-timestamp": timestamp,
      "x-phonehome-signature": signature,
    },
    body,
  });
  if (!response.ok) throw new Error(`provisioner-http-${response.status}`);
}
