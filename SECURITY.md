# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting instead:
**Security** tab of this repository → **Report a vulnerability**. If that is not available, contact the repository
owner through the profile on GitHub.

Include what is affected, the steps to reproduce it, and the version (commit or image tag) you tested. Give the
maintainers reasonable time to fix it before disclosing it publicly, do not run automated scans against someone
else's installation without permission, and do not access or change data that is not yours.

## What is protected

- Hub files are stored privately and served only through short-lived signed links.
- Hub secrets are encrypted at rest with `TEAM_OPS_SECRET_KEY`; only the publisher and the people they choose can
  read a value, administrators included.
- Never commit `.env` files, keys, tokens or database dumps. Use the `.env.example` files as templates only.
