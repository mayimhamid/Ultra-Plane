# Trusting the Ultra Plane certificate on each device

The public address `https://plane.5.160.42.168.sslip.io:4433` does not use a certificate from a public
authority. Chrome treats a site with an untrusted certificate as not secure. On such a site it does not
register the service worker, does not deliver push notifications, and "Install" only makes a shortcut that
opens in a normal tab. Once a device trusts our private certificate authority (CA), all three work.

## What gets installed, and why it is safe

`ultra-plane-ca.crt` (PEM) and `ultra-plane-ca.cer` (DER) contain the same public CA certificate. Neither file
holds a private key.

- **Name-constrained:** the CA can only vouch for `5.160.42.168.sslip.io`, its subdomains, and the IP
  `5.160.42.168`. A certificate it signs for any other name, such as a bank, fails on every device, even if
  the CA key leaks. This was tested: a test certificate for `www.google.com` was rejected with "permitted
  subtree violation".
- It can sign server certificates only (`pathlen:0`), and it is valid until 2036-11-01.
- SHA-256 fingerprint. Compare it before installing:

```
18:3C:1B:C9:25:22:96:8F:0A:A4:96:03:4A:69:AA:A0:C6:71:88:A4:D3:7C:2D:71:36:EF:4C:D5:FC:26:CC:6B
```

`openssl x509 -in ultra-plane-ca.crt -noout -fingerprint -sha256`

The server certificate is signed by this CA. It covers `5.160.42.168`, `5.160.42.168.sslip.io` and
`*.5.160.42.168.sslip.io`, has the server-auth usage, and is valid until 2029-02-01. That is under Apple's
825-day limit, which is what makes it work on iPhone and Mac. **Renew it before 2029-02-01**. See the end
of this page.

## Windows (Chrome, Edge)

1. Open PowerShell as your own user (no admin needed) in this folder and run:
   `Import-Certificate -FilePath .\ultra-plane-ca.crt -CertStoreLocation Cert:\CurrentUser\Root`
   Answer **Yes** to the security warning.
   (By hand: double-click the file → Install Certificate → Current User → "Place all certificates in the
   following store" → Trusted Root Certification Authorities → Finish → Yes.)
2. Close Chrome completely, including from the tray, then open it again.
3. Open the site. The address bar should no longer show "Not secure".
4. If you made a shortcut earlier, remove it: go to `chrome://apps`, right-click it, and choose Remove.
5. Menu ⋮ → Cast, save and share → **Install page as app**, or click the install icon in the address bar.
6. Turn notifications on from the prompt inside the app.

To remove it later: `certmgr.msc` → Trusted Root Certification Authorities → Certificates → "Ultra Plane
Private CA" → Delete.

## Android (Chrome)

1. Copy `ultra-plane-ca.crt` to the phone.
2. Settings → Security & privacy → More security settings → Encryption & credentials → Install a
   certificate → **CA certificate** → Install anyway → pick the file. The menu names vary by vendor. Search
   Settings for "certificate".
3. Close Chrome fully and open the site again.
4. Chrome ⋮ → **Add to home screen** → **Install**.

To remove it later: Encryption & credentials → Trusted credentials → User → the certificate → Remove.

## iPhone and iPad (Safari)

1. Send `ultra-plane-ca.cer` to the device, for example by AirDrop or mail, and open it. Choose **Allow** to
   download the profile.
2. Settings → General → VPN & Device Management → the profile → **Install**.
3. Settings → General → About → **Certificate Trust Settings** → turn on full trust for "Ultra Plane Private
   CA". Without this step, the certificate is installed but not trusted.
4. In Safari open the site → Share → **Add to Home Screen**. Open the app from the home screen and turn on
   notifications there. iOS delivers web push only to apps added to the home screen.

## Mac

1. Double-click `ultra-plane-ca.cer` → Keychain Access adds it to the "login" keychain.
2. Open it in Keychain Access → Trust → "When using this certificate" → **Always Trust**, then close the window
   and enter your password.
3. Restart Chrome, open the site, then Menu ⋮ → Cast, save and share → Install page as app.

## For the administrator

The CA private key and the server key are **not** in the repository. They are in
`C:\Users\Hamid\ultra-plane-pki\` (`ca.key`, `server.key`, `server.crt`, `fullchain.crt`, configs). Back
up `ca.key` somewhere safe and offline. Anyone holding it can issue certificates for this server's names, and
losing it means every device has to install a new CA.

Installing on the server: the TLS endpoint for port 4433 is served with the certificate the outer proxy
uses (`smartfactory-nginx`). Replace that certificate with `fullchain.crt` and its key with `server.key`. The
new certificate covers the same names as the old one, so the other sites behind that proxy keep working.
Keep a copy of the old files, run `nginx -t`, then reload nginx. Devices that have not installed the new CA
will see the usual warning until they do.

Renewing the server certificate (before 2029-02-01), in that folder:

```
openssl req -new -newkey rsa:2048 -nodes -keyout server.key -out server.csr -config server.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 820 -sha256 -extfile server.cnf -extensions v3_srv
cat server.crt ca.crt > fullchain.crt
```

Devices do not need to install anything again. They trust the CA, not the server certificate.
