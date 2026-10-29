# Names and logos

The [MIT License](LICENSE) covers Phevere's code: you may use, change and share it. It does not cover these names and marks, which identify the official apps and the account behind them:

- **Holarky**, and the Holarky mark (the leaning h with an outlined leg);
- **Phevere** and the Phevere icon;
- **knowrld**.

## What you may do

- Say what your work is based on, for example "a fork of Phevere" or "built with Phevere's dictionary core".
- Share unmodified official builds from [GitHub Releases](https://github.com/thd2020/phevere/releases) under their own names.
- Use the names to refer to the official apps, for example in articles, reviews and teaching.

## What a modified version must do

- Use a different name and icon, so people do not take it for the official app.
- Use its own account settings, or none. `HOLARKY_ACCOUNT` in `packages/core/src/account.ts` points at the Holarky account service, which signs people in to the official apps only. Change it (or set `apiBase` to `''`, which turns sign-in off) before publishing a build.
- Not suggest that Holarky made, checked or supports it.

## Asking

For anything else, such as using a name or mark in a product or a partnership, ask [thd2020](https://github.com/thd2020) first.
