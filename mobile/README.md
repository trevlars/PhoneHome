# PhoneHome iOS (Capacitor)

Native shell around the existing softphone for **CallKit + PushKit**.

See **[`docs/native-ios-callkit.md`](../docs/native-ios-callkit.md)** for Apple setup and server env.

```bash
# from repo root
npm run build -w web
cd mobile && npm install && npx cap sync ios && npx cap open ios
```

Bundle id: `app.phonehome.ios`
