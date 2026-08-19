# Windows code signing (Authenticode)

This is about the **publisher name** Windows shows on `Phevere-Setup-*.exe`, and SmartScreen. It is **not** the same as GitHub **artifact attestations** (`actions/attest` on tagged releases). Attestations prove “this file came from this repo’s workflow.” They do **not** make SmartScreen go away.

Microsoft’s current comparison: [Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options) (updated 2026-04).

## Can you “just sign it yourself”?

**Not in a way the public internet will trust.**

| What you can do alone | What Windows does for a stranger who downloaded GitHub Releases |
|---|---|
| `New-SelfSignedCertificate` / a homemade CA, then `signtool` / `CSC_LINK` | **Blocks or scary-warns.** Self-signed is not in the [Microsoft Trusted Root Program](https://learn.microsoft.com/en-us/security/trusted-root/participants-list). The user would have to **install your cert as a trusted root** first. Fine on *your* PCs; useless for random Win11 home machines. |
| GitHub attestation | Properties → Digital Signatures stays empty. SmartScreen still treats the file as unsigned. |
| Timestamping without a public CA | Same as unsigned for SmartScreen. |

Since June 2023, public OV/EV code-signing keys must live on an **HSM or USB token**. You cannot keep a “.pfx on disk forever” from a public CA the old way.

**EV no longer skips SmartScreen** (Microsoft removed that in 2024). OV and EV both need **download reputation** to build. First releases of a new publisher still warn.

## Realistic paths (2026)

### 1. SignPath Foundation (best “do it without buying a CA cert” for this repo)

Phevere is **MIT**, public, and already ships GitHub Releases — that matches the [SignPath Foundation OSS program](https://signpath.org/).

- They sign CI-built binaries on their HSM. You never hold the private key.
- Windows publisher name is **SignPath Foundation**, not `thd2020`.
- Free if they accept the project. Apply at signpath.org; they review (license, no malware, documented downloads, active repo).
- After approval: GitHub Actions submits the Setup.exe to SignPath, then you attach the signed file to the Release (or they return it into the workflow).

This is the only practical “sign it yourself” path that still uses a **Microsoft-trusted** CA, without paying DigiCert/Sectigo, and without living in the US/Canada.

### 2. Buy an OV certificate (publisher = your legal name / company)

Typical **$150–300/year**. Identity check takes days. Key on USB token or the CA’s cloud HSM.

Then either:

```powershell
$env:CSC_LINK = "C:\secure\phevere-codesign.pfx"   # or token/cloud as the CA documents
$env:CSC_KEY_PASSWORD = "<password>"
npm run make:win
```

or set repo secrets `CSC_LINK` + `CSC_KEY_PASSWORD` for `release.yml` (USB tokens do **not** plug into GitHub-hosted runners — you need cloud HSM / SignPath / Azure).

**Azure Artifact Signing** (~$10/month, no USB) is **not available to individuals outside the USA and Canada** (orgs: US, CA, EU, UK only). A China-based individual cannot use it for public-trust signing.

### 3. Microsoft Store (MSIX)

Store **re-signs** MSIX. No SmartScreen on Store install. That is a **different package** than today’s NSIS Setup.exe — Partner Center, Store policies, often delayed review. MSI/EXE submitted to the Store must already be CA-signed; Store does not re-sign those.

### 4. Self-signed — this machine only

For confirming `signtool` / electron-builder hooks locally:

```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Phevere local test" -CertStoreLocation Cert:\CurrentUser\My
Export-PfxCertificate -Cert $cert -FilePath "$env:USERPROFILE\phevere-local-test.pfx" -Password (Read-Host -AsSecureString)
# Trust it on THIS PC only:
#   certmgr.msc → Trusted Root (or Trusted Publishers) → import the .cer
$env:CSC_LINK = "$env:USERPROFILE\phevere-local-test.pfx"
$env:CSC_KEY_PASSWORD = "<that password>"
npm run make:win
```

Do **not** commit the `.pfx`. Do **not** ship this Setup to GitHub and expect SmartScreen to calm down.

## What Phevere already does

- `scripts/make-win.js` signs when `CSC_LINK` / `CSC_NAME` / `WIN_CSC_LINK` is a real path or base64 PFX; **strips empty GitHub secrets** so unsigned CI does not crash.
- `electron-builder.yml` timestamps with DigiCert RFC3161 when a cert is present.
- Tagged `release.yml` attests the exe (`gh attestation verify … -R thd2020/phevere`).

Unsigned GitHub Releases remain the default until SignPath or an OV cert is wired.

## Suggested next step

Apply to **SignPath Foundation** for `thd2020/phevere` (MIT + existing `v1.3.x` Releases). If they accept, add their GitHub Action after `make:win` and stop shipping unsigned Setup. Buying OV is the alternative if the publisher **must** show your name, not SignPath’s.
