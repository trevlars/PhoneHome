import assert from "node:assert/strict";
import { test } from "node:test";
import {
  devicesToStopRinging,
  isSecondDevice,
  keepSocketOnClaim,
  sameDevice,
  type DeviceSocket,
} from "./callDevices.js";

const safari: DeviceSocket = { lineId: "line_dad", sessionId: "s_safari" };
const safariReconnect: DeviceSocket = { lineId: "line_dad", sessionId: "s_safari" };
const app: DeviceSocket = { lineId: "line_dad", sessionId: "s_app" };
const houseBridge: DeviceSocket = { lineId: "line_house", isBridge: true, sessionId: "s_bridge" };
const otherLine: DeviceSocket = { lineId: "line_mom", sessionId: "s_mom" };

test("sameDevice matches only a shared login session", () => {
  assert.equal(sameDevice(safari, safariReconnect), true);
  assert.equal(sameDevice(safari, app), false);
  assert.equal(sameDevice({ lineId: "x" }, { lineId: "x" }), false);
  assert.equal(sameDevice(null, safari), false);
});

test("the app's late CallKit answer is a second device once Safari owns the call", () => {
  assert.equal(isSecondDevice(safari, app), true);
});

test("the owner, its reconnect, bridges, and other lines are not second devices", () => {
  assert.equal(isSecondDevice(null, app), false);
  assert.equal(isSecondDevice(safari, safari), false);
  assert.equal(isSecondDevice(safari, safariReconnect), false);
  assert.equal(isSecondDevice(safari, { ...houseBridge, lineId: "line_dad" }), false);
  assert.equal(isSecondDevice(safari, otherLine), false);
});

test("answering stops ringing only on other devices of the same line", () => {
  const sockets = [safari, safariReconnect, app, houseBridge, otherLine];
  assert.deepEqual(devicesToStopRinging(safari, sockets), [app]);
  assert.deepEqual(devicesToStopRinging(app, sockets), [safari, safariReconnect]);
  assert.deepEqual(devicesToStopRinging(houseBridge, sockets), []);
});

test("a second device's hello does not kick a socket in an open call", () => {
  assert.equal(keepSocketOnClaim(safari, app, true), true);
  assert.equal(keepSocketOnClaim(safari, app, false), false);
  assert.equal(keepSocketOnClaim(safari, safariReconnect, true), false);
  assert.equal(keepSocketOnClaim(houseBridge, { ...houseBridge, sessionId: "s_b2" }, true), false);
});
