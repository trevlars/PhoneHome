# Bluetooth landline SKU D

## Product

Kid-facing handset with keypad + mic/speaker. Pairs to parent phone. App soft-hub / CallKit places Digits-like calls; audio routes to HFP device.

## Stack

| Layer | Tech |
| --- | --- |
| Audio | Bluetooth Classic **HFP** |
| Buttons | **BLE GATT** (dial, hook, quick-dial) |
| Brain | Parent app (not the handset) |

## MVP path

1. Commercial **Cell2Jack** / HFP landline adapter + Stage 1/2 app.  
2. Custom enclosure + ESP32 HFP (`a2dpSinkHfpClient` / weeBell BT).  
3. weeBell: real RJ11 phone as HFP to cellphone.

## App behavior

1. Pair → mark as Kids Line audio device.  
2. Incoming: CallKit / ConnectionService → route to HFP.  
3. Outbound: BLE digits → app places WebRTC call.  
4. BT drop: warn + fall back to phone speaker.

## Limits

~10 m range; HFP often narrowband; needs native app (not web-only) for reliable incoming.
