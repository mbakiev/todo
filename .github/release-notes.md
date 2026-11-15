## Download

| Your computer | File |
|---|---|
| Mac with Apple silicon (M1 or later) | `MartinsToDos-{{VERSION}}-mac-arm64.dmg` |
| Mac with an Intel processor | `MartinsToDos-{{VERSION}}-mac-x64.dmg` |
| Windows 10 / 11 with an Intel or AMD processor | `MartinsToDos-{{VERSION}}-win-x64-setup.exe` |
| Windows 11 with an Arm processor (e.g. Snapdragon) | `MartinsToDos-{{VERSION}}-win-arm64-setup.exe` |

Not sure which Windows file? Settings → System → About → *System type* says "x64-based
processor" or "ARM-based processor". The `.zip` files contain the same Mac apps without the
disk image. `SHA256SUMS.txt` lists a checksum for every file.

## First launch

The installers are not signed with a paid developer certificate, so the operating system asks
before running them:

- **macOS:** open the `.dmg` and drag the app to Applications. The first time you open it,
  macOS says it cannot verify the app. Open System Settings → Privacy & Security, scroll down
  and click **Open Anyway**.
- **Windows:** when "Windows protected your PC" appears, click **More info** → **Run anyway**.
  The installer is per-user and does not need administrator rights.

Your tasks are stored in your user data folder, not inside the app, so installing a newer
version does not touch them. See the
[User Guide](https://github.com/{{REPOSITORY}}/blob/{{TAG}}/docs/USER_GUIDE.md) for how to use
the app.

Every build is tested automatically on macOS and Windows (Intel/AMD and Arm) before it is
published. The Intel Mac build is produced by the same process but is not launched by those
tests.
