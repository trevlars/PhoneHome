fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios asc_info

```sh
[bundle exec] fastlane ios asc_info
```

Print App Store Connect app record for app.phonehome.ios

### ios prepare_deliver

```sh
[bundle exec] fastlane ios prepare_deliver
```

Map generated screenshots into fastlane deliver folder layout

### ios upload_listing

```sh
[bundle exec] fastlane ios upload_listing
```

Upload metadata + screenshots to App Store Connect (no binary)

### ios upload_metadata

```sh
[bundle exec] fastlane ios upload_metadata
```

Upload metadata text only

### ios upload_all

```sh
[bundle exec] fastlane ios upload_all
```

Prepare deliver folders + upload screenshots and metadata

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
