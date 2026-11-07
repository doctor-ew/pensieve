# QA — 2026-11-07
- pnpm check-types: PASS.
- pnpm build: PASS.
- pnpm test: 86 passed, 0 failed, 0 skipped.
- pnpm audit --prod: no known vulnerabilities.
- git diff --check: PASS.
- Independent code reviewer: APPROVE after service JWT, persistent receipt and N+1 fixes.
- Independent security auditor: APPROVE after proxy bucket and invitation membership-oracle fixes; independently reran 7 focused tests.
- Browser fixture: capture, search/list controls, selected bundle download, bearer invite, explicit SES-like fake send, duplicate suppression, email-code sign-in, revocation, private policy and reader isolation. No real email sent.
- Not performed: live Cloudflare/SES/Turnstile activation, DNS change, real inbox delivery, penetration test, backup restore. These remain separate release gates.
