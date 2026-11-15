# Third-Party Software & Trademark Notices

This repository is an **unofficial community project**. It is **not affiliated with, endorsed by, sponsored by, or approved by** Tailscale Inc., DeepSeek, or any other third party mentioned here.

The MIT license in [LICENSE](LICENSE) applies **only to the code in this repository**. Third-party names, logos, software and services remain the property of their respective owners and are subject to their own licenses and terms.

---

## Tailscale

- The project **does not include, bundle, modify, or redistribute any Tailscale code**.
- Tailscale is used **only as an optional network transport**: the scripts may call a locally installed Tailscale CLI (`tailscale ip`, `tailscale serve`) and the gateway listens on the machine's Tailscale address. The user installs and runs Tailscale themselves.
- You must comply with Tailscale's own terms and licensing when using it, including:
  - Tailscale Terms of Service: <https://tailscale.com/legal/terms-of-service>
  - Tailscale open-source client licenses: <https://github.com/tailscale/tailscale/blob/main/LICENSE>
- "Tailscale" and the Tailscale logo are trademarks of Tailscale Inc. This project uses the name only to factually describe the optional transport it can work with.
- This project does not provide, resell, or proxy any Tailscale service. Connectivity depends entirely on the user's own Tailscale account and tailnet.

## DeepSeek Harness (DSH)

- This is a **third-party, unofficial** tool. It is not affiliated with DeepSeek.
- "DeepSeek", "DeepSeek Harness" and the related logo/icon are the property of their respective owners.
- The project does **not** modify, redistribute, or include DSH code. It proxies HTTP/WebSocket traffic to the user's own locally installed DSH instance.
- The DSH name and icon are used only to identify the user's locally installed app when the page is added to the iOS home screen (PWA), in a nominative/fair-use manner. If you are a rights holder and believe this usage is inappropriate, please open an issue and it will be adjusted promptly.

## Node.js

- Node.js is used as a runtime dependency only. It is not bundled in this repository.
- Node.js is licensed under the MIT license: <https://github.com/nodejs/node/blob/main/LICENSE>

## Other

- No other third-party JavaScript libraries are bundled by this project.
- Platform names (iPhone, iPad, iOS, Safari, Windows, Tailscale, Xiaohongshu, Douyin) are trademarks of their respective owners and are used only for descriptive purposes.
- The project is provided as-is, without warranty of any kind. See [LICENSE](LICENSE).
