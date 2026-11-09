# PhoneHome CallKit Android library. Do not keep FCM tokens or credentials in logs.
# Bridge script is re-registered for the saved Mothership origin via reflection.
-keepclassmembers class com.getcapacitor.Bridge {
    private com.getcapacitor.JSInjector getJSInjector();
}
-keepclassmembers class com.getcapacitor.JSInjector {
    public java.lang.String getScriptString();
}
-keep class org.webrtc.** { *; }
