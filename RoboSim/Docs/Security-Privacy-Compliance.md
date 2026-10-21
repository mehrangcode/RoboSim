# RoboSim — Security, Privacy & Compliance

**Version:** 1.0 · **Date:** 2026-10-13 · **Owner:** Engineering lead (security), Legal counsel (compliance)
**Related:** [Technical Design](Technical-Design.md) · [API Spec](API-Spec.md) · [PRD §8](PRD.md#8-non-functional-requirements)

> **Legal note.** Sections 6 and 8 describe the product's compliance design. Statutory details (rates, registration procedures, retention periods) must be confirmed by Mehrtronic's legal counsel and accountant before P2 launch; items marked **[confirm]** are known to need that review.

---

## 1. Scope and baseline

| Item | Baseline |
|---|---|
| Application security standard | OWASP ASVS 4.0 Level 2 for all services; Level 3 controls for authentication, payments, build sandbox, and key storage |
| Web | OWASP Top 10 mitigations; strict CSP; COOP/COEP; HSTS preload |
| Infrastructure | CIS Kubernetes Benchmark; Pod Security Standards `restricted` (except sandbox node pool with gVisor) |
| Testing | SAST, dependency and container scanning on every PR; DAST weekly on staging; external penetration test before 1.0 GA and annually |
| Ownership | Security champion per team; security review mandatory for changes to IAM, billing, sandbox, AI keys, tenancy |

## 2. Data classification

| Class | Examples | Controls |
|---|---|---|
| **Secret** | Passwords (hashed), TOTP secrets, BYOK API keys, SSO client secrets, payment gateway credentials, licence signing key | Envelope-encrypted or hashed; access only by the owning service; never logged; rotated |
| **Confidential – personal** | Name, email, phone, date of birth, addresses, guardian contacts, IP addresses, grades | Encrypted at rest (volume + column-level for DOB, phone, guardian contact); least-privilege access; retention limits (§6.5) |
| **Confidential – business** | Orders, invoices, payments, org contracts, analytics | Encrypted at rest; finance/role-restricted |
| **Internal** | Private projects, AI conversations, comments | Tenant isolation; owner/share-based access |
| **Public** | Gallery items, public competitions, catalogue | Integrity controls only |

## 3. Threat model (STRIDE summary)

| Asset / flow | Threat | Mitigation |
|---|---|---|
| Build farm | **E**levation: user C++ escapes compiler container | §5 sandbox (gVisor, no network, disposable, limits); sandbox nodes isolated and tainted |
| Build farm | **D**oS: expensive compiles, queue flooding | Quotas, rate limits, fair-share, input size caps, timeouts |
| Grader | **T**ampering: forged client results for grades | Only server verified runs count; client results labelled unofficial |
| Grader | **E**levation: firmware exploits emulator | Firmware runs inside JS emulator; grader pods have no network, resource limits, short lifetime |
| Sessions | **S**poofing: session theft, CSRF | `__Host-` HttpOnly Secure cookies, SameSite=Lax, CSRF tokens, session binding to UA family, rotation on privilege change |
| Accounts | **S**poofing: credential stuffing, OTP brute force | argon2id, breached-password check (offline k-anonymity list), throttling, lockout, OTP attempts ≤ 5, MFA |
| Tenancy | **I**nformation disclosure: cross-workspace access | RLS + application guards + CI isolation tests; IDs are not authorization |
| Payments | **T**ampering: amount manipulation, replayed callbacks | Server-side price snapshot, gateway `verify` with amount, idempotent authority handling, reconciliation |
| AI | **I**nformation disclosure: key leakage; prompt injection via project content | Envelope encryption, no key egress to browser, egress allow-list; content treated as data; no side-effect tools; patches require user approval |
| Community | Abuse, grooming risk for minors | No DMs, pre-moderation for minors, contact-info filters, reporting, age-band policies |
| Admin | **R**epudiation / insider misuse | MFA, IP allow-list option, least-privilege staff roles, consented impersonation, append-only audit log |
| Exports | **I**nformation disclosure via shared links | Signed, short-lived URLs (15 min); entitlement and permission check at creation |
| Supply chain | Malicious dependency or image | Lockfiles, Verdaccio mirror with allow-list, SBOM (CycloneDX), image signing (cosign), Harbor vulnerability scanning, Renovate with review |
| Web client | XSS via user content (descriptions, comments, markdown) | Sanitized markdown subset (DOMPurify), strict CSP with nonces, no `dangerouslySetInnerHTML` outside the sanitizer |

## 4. Authorization model and RBAC matrix

Authorization = **role** (platform or workspace) × **resource relationship** (owner, class member, share role) × **org policy** × **age band** × **entitlement**. All checks run server-side in the policy service; the UI only mirrors them.

### 4.1 Workspace roles

| Permission | org_owner | org_admin | billing_manager | teacher | assistant_teacher | student |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View org settings | ✓ | ✓ | ✓ | — | — | — |
| Edit org profile, domains, policies | ✓ | ✓ | — | — | — | — |
| Configure SSO / SCIM / LTI | ✓ | ✓ | — | — | — | — |
| Manage members and roles | ✓ | ✓ | — | — | — | — |
| Manage seats, plans, invoices, payments | ✓ | — | ✓ | — | — | — |
| Delete organization | ✓ (MFA) | — | — | — | — | — |
| Create classes | ✓ | ✓ | — | ✓ | — | — |
| Manage own classes (roster, assignments) | ✓ | ✓ | — | ✓ | ✓ (no delete) | — |
| View student work in own classes | ✓ | ✓ | — | ✓ | ✓ | — |
| Grade, release grades | ✓ | ✓ | — | ✓ | ✓ (not after release) | — |
| View org analytics | ✓ | ✓ | — | own classes | own classes | — |
| Export audit logs | ✓ | ✓ | — | — | — | — |
| Create own projects in org | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| Submit assignments | — | — | — | — | — | ✓ |
| Publish org templates | ✓ | ✓ | — | ✓ | — | — |

### 4.2 Platform staff roles

| Capability | platform_admin | content_editor | shop_operator | finance | support_agent | moderator |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Manage staff roles | ✓ | — | — | — | — | — |
| Users/orgs: view | ✓ | — | — | ✓ (billing data) | ✓ | limited |
| Users/orgs: suspend, overrides | ✓ | — | — | — | — | — |
| Consented read-only impersonation | ✓ | — | — | — | ✓ | — |
| Catalogue, content, arenas, translations | ✓ | ✓ | — | — | — | — |
| Products, stock, orders, shipping | ✓ | — | ✓ | view | view | — |
| Plans, prices, coupons, refunds, invoices, tax | ✓ | — | — | ✓ | — | — |
| Moderation queue | ✓ | — | — | — | — | ✓ |
| AI provider enablement | ✓ | — | — | — | — | — |
| Feature flags | ✓ | — | — | — | — | — |
| Audit log | ✓ | — | — | own scope | — | own scope |

### 4.3 Project-level access

| Relationship | View | Comment | Edit | Delete | Share |
|---|:-:|:-:|:-:|:-:|:-:|
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ |
| Share role `edit` | ✓ | ✓ | ✓ | — | — |
| Share role `comment` | ✓ | ✓ | — | — | — |
| Share role `view` / link | ✓ | — | — | — | — |
| Teacher of the class (assignment projects) | ✓ | ✓ | — | — | — |
| org_admin (org-owned projects) | ✓ | — | — | ✓ (policy) | ✓ |

*Enforced (2026-10-21):* by `ProjectsService` / `SharingService` access checks **and** RLS policies (`projects_shared_read`, `projects_shared_edit`, `project_shares_*`), so a bug in one layer does not open another user's project. Viewers (share role `view` or a link) can also copy the project into their own workspace, credited to the owner. Share-link tokens are HMAC-derived and stored hashed (§9); `SHARE_LINK_SECRET` must be a private value outside local and test.

## 5. Untrusted code execution sandbox

User C++ is untrusted input executed by the compiler toolchain (preprocessor, compiler, linker can all be abused). Controls, all mandatory:

| Layer | Control |
|---|---|
| Input | ≤ 100 KB, ≤ 20 files, strict filename regex, no absolute or `..` includes, allow-listed libraries only, null bytes rejected |
| Runtime | gVisor (`runsc`) RuntimeClass; one fresh container per job, destroyed after; never reused across users |
| Network | `--network=none` / NetworkPolicy deny-all for sandbox pods; no metadata service reachable |
| Filesystem | Read-only root; `/work` tmpfs 64 MB; toolchain and libraries read-only; no service account token mounted |
| Resources | 1 vCPU, 512 MB memory, 128 PIDs, 30 s wall clock, stdout/stderr capped at 1 MB |
| Identity | Non-root UID, all capabilities dropped, `no_new_privileges`, seccomp `RuntimeDefault` |
| Placement | Dedicated tainted node pool; no other workloads; nodes recycled daily |
| Output | Only declared artifacts (HEX/UF2/ELF, size report) copied out, size-checked, hashed |
| Monitoring | Alerts on sandbox OOM/time-out spikes, unexpected syscalls (gVisor logs), egress attempts |
| Verification | Security test suite in CI (network access, fork bomb, disk fill, huge diagnostics, `#include "/etc/passwd"`, recursive macros, linker scripts) must fail safely |

*Development runtime ([ADR-022](decisions.md#adr-022--build-service-drives-avr-gcc-directly-linux-namespace-sandbox-for-development)).* With `COMPILER_RUNTIME=local` there is no gVisor. Each toolchain call runs in new unprivileged user, mount, PID and network namespaces:

- **Network:** loopback only.
- **Processes:** a private `/proc`.
- **Filesystem:** the work dir is the only writable bind mount. The toolchain and prebuilt archives are read-only. `/home`, `/mnt`, `/root`, `/tmp`, `/var` and `/run` are hidden behind empty tmpfs, so the repository, `.env` and other processes' environments are unreachable.
- **Limits:** `prlimit` caps address space at 1 GB, file size at 64 MB, CPU at 30 s and open files at 256. A wall-clock kill enforces the 30 s budget, and output is capped at 256 KB.
- **Guards:** the source guards above run before gcc and also reject `.incbin`/`.include` assembler directives and macro includes.

The API rejects this runtime when `APP_ENV` is `staging` or `production`. Tests cover these cases (`apps/compiler/test/compiler.test.ts`): no network, hidden home/project, private `/proc`, read-only toolchain, `/etc/passwd` and `..` includes, the time limit, and host paths stripped from diagnostics. Fork-bomb, disk-fill and recursive-macro cases are still open for the gVisor suite.

The grader applies equivalent pod isolation (no network beyond Redis/object storage, limits, short-lived) even though firmware only runs inside the emulator.

## 6. Privacy and protection of minors

### 6.1 Principles

Data minimization, purpose limitation, transparency in both languages, safe defaults for minors, user control (export, delete), no sale of personal data, no third-party trackers or advertising SDKs.

### 6.2 Age bands and consent

| Age band | Sign-up path | Defaults |
|---|---|---|
| Under 13 (`u13`) | **Only** through an organization (school/academy) that attests to having parental consent; no self-signup | Community publishing and commenting off; AI limited to platform model in tutor mode; no marketing; no public profile |
| 13–15 (`13_15`) | Self-signup requires **guardian consent** (email or SMS link); until confirmed: demo mode only (`consent_pending`) | Community: view only, publications pre-moderated; AI platform model only; no BYOK; no marketing |
| 16–17 (`16_17`) | Self-signup with guardian notification | Publications pre-moderated; no public comments unless org allows; no marketing; BYOK off |
| Adult | Self-signup | Standard |

- Age is collected as date of birth; it is stored encrypted and used only to compute the age band. The band is recomputed on birthdays (a nightly job), which relaxes defaults automatically.
- Organizations can only make policies **stricter** than these defaults for minors.
- Guardians can revoke consent via the link in the consent email/SMS; the account then returns to demo mode and the guardian can request deletion.

### 6.3 Features never available

Direct/private messaging between users; location sharing; public display of real names of minors (display names only); contact details in public content (blocked by filter).

### 6.4 Analytics and AI

- Product analytics are first-party and server-side; minors are excluded from marketing analytics and A/B tests that change pricing or marketing.
- AI conversations of minors are retained only as long as needed for the session history window (default 30 days for minors, 90 days for adults) and are never used for model training. Platform models are not fine-tuned on user data without explicit opt-in from adult users.

### 6.5 Retention schedule

| Data | Retention |
|---|---|
| Account profile | Lifetime of account; purged 14 days after deletion request |
| Projects and versions | Until deleted by owner/org; version retention per plan; trash 30 days |
| Build jobs / artifacts | Job metadata 90 days; artifacts 30 days (longer if referenced by a submission) |
| Submissions, grades, verified runs | Per org policy (default: 3 academic years); then anonymized |
| AI conversations | 30 days (minors) / 90 days (adults), configurable shorter by org |
| Sessions, auth tokens | Sessions 30 days idle; tokens until expiry + 7 days |
| Audit logs | 2 years (Institution: configurable up to 7) |
| Payments, invoices, orders | As required by tax and commercial law **[confirm]**; personal data minimized after the legal period |
| Logs (application) | 30 days; security logs 1 year |
| Backups | 35 days rolling; deletions propagate as backups expire |

### 6.6 Data subject rights

Export (JSON + `.robosim`, within 24 h automated), correction (profile), deletion (14-day grace; then purge across services; search index and caches invalidated), objection to marketing (one click). Organization members' data controlled by the organization is exported/deleted through the org admin, with the platform acting as processor under the data-processing agreement (Institution).

## 7. AI-specific security

| Risk | Control |
|---|---|
| Key exfiltration | Envelope encryption (AES-256-GCM DEK wrapped by OpenBao Transit KEK); decrypt in AI module memory only; keys never in logs, traces, or error messages (redaction middleware + log scanning tests) |
| Prompt injection from project content | Content passed as delimited data; system prompt precedence; the model has no tools with side effects; all proposals validated and require user Apply |
| Harmful or inappropriate output | Output classifier/filter for both languages; stricter thresholds for minors |
| Data residency | Platform model hosted in the deployment region; BYOK providers explicitly disclose that data leaves the deployment |
| Provider terms and availability | Each external provider is enabled per deployment only after legal approval (`ai_provider_configs.legal_approved_at`) and a reachability check; RoboSim does not provide or recommend any means to bypass a provider's regional restrictions ([ADR-009](decisions.md#adr-009--platform-hosted-open-weight-models-as-the-default-ai)) |
| Cost abuse | Credits, rate limits, per-org ceilings, anomaly alerts |

## 8. Iranian legal and commercial compliance

| Obligation | Product/operational design | Owner |
|---|---|---|
| **eNamad** trust seal (اینماد) for the e-commerce site | Apply in P0; display seal on site footer and checkout; business information pages (address, phone, terms) in FA | Legal / management |
| **Shaparak-connected payment gateway** | Only licensed PSP gateways (e.g. Zarinpal) behind `PaymentProvider`; card data never touches RoboSim servers (redirect flow) | Finance / engineering |
| **Electronic Commerce Law** and consumer protection | Clear pricing (VAT-inclusive for consumers), terms of sale, return policy for goods, order confirmation records | Legal |
| **VAT** (مالیات بر ارزش افزوده) | VAT rate configurable in admin (`tax_settings`, effective-dated) **[confirm current rate and whether digital subscriptions and goods differ]**; VAT itemized on business invoices | Finance |
| **Moodian e-invoicing** (سامانه مودیان) | `TaxInvoiceProvider` adapter submitting official invoices through a certified trusted provider (شرکت معتمد) or direct API; status tracked per invoice; retries and rejection handling **[confirm scope: which invoice types and thresholds]** | Finance / engineering |
| **Website registration** (e.g. ساماندهی) and hosting rules | Register domain/site as required **[confirm current requirements]**; host SaaS in Iran | Legal / SRE |
| **Personal data protection** | Iran has no enacted comprehensive data protection statute at time of writing; the platform applies the principles in §6 (comparable to international norms) and will adapt when legislation is enacted **[confirm status]** | Legal |
| **Content and minors** | Moderation (§3, FR-CMY-04), minors' defaults (§6.2), cooperation process for lawful requests documented | Trust & safety |
| **Shipping** | Carrier terms, insurance of parcels, return logistics | Commerce |
| **Software licences** | Third-party licence inventory (SBOM); avr8js/rp2040js (MIT), avr-gcc/binutils/avr-libc (GPL/LGPL/BSD, Ubuntu packages used as separate tools — not linked into proprietary code; ADR-022 replaced arduino-cli), Arduino cores and libraries (LGPL/GPL/MIT — distributed only inside the build image; source offer maintained), Blockly (Apache-2.0), three.js (MIT), Planck.js (MIT) | Engineering / legal |
| **International users** | Paid plans only via Iranian payment or institutional contract; no targeting of EU residents; privacy policy explains processing location | Legal |

## 9. Cryptography and secrets

| Use | Algorithm / mechanism |
|---|---|
| Passwords | argon2id (m = 64 MiB, t = 3, p = 1; parameters reviewed yearly) |
| Tokens (reset, invite, consent, share links) | 256-bit random; stored as SHA-256 hashes; single use; short expiry |
| OTP | 6 digits, 2-minute expiry, ≤ 5 attempts, per-phone and per-IP throttling |
| TOTP secrets, SSO secrets, DOB, phone, guardian contact | AES-256-GCM via OpenBao Transit (column-level) |
| BYOK keys | Envelope encryption (per-key DEK + Transit KEK) |
| Transport | TLS 1.2+ (TLS 1.3 preferred) externally; mTLS between services |
| Webhooks | HMAC-SHA256 with per-subscription secret |
| Licence files | Ed25519 signatures |
| Rotation | KEKs yearly or on incident; gateway and provider credentials per provider policy; secrets never in Git (pre-commit + CI secret scanning) |

## 10. Secure development lifecycle

1. Threat-model update for every new module or external integration (template in `Docs/` PR checklist).
2. Mandatory reviews: two approvals for `iam`, `billing`, `entitlements`, `compiler`, `ai` (keys), RLS migrations.
3. CI gates: ESLint security rules, Semgrep, `pnpm audit` with allow-list, Trivy for images, secret scanning, licence check, tenant-isolation tests, sandbox escape suite.
4. Dependency updates via Renovate, grouped weekly, auto-merge only for patch updates of dev dependencies.
5. Security headers verified by automated tests (CSP, HSTS, COOP/COEP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` allowing `serial=(self)` only).
6. Bug reporting: `security.txt` with contact; responsible disclosure policy.

## 11. Incident response

| Phase | Action |
|---|---|
| Detect | Alerts (SLO burn, auth anomalies, sandbox anomalies, payment mismatches), user reports |
| Triage | On-call classifies severity (SEV1–SEV4) within 15 min (SEV1/2) |
| Contain | Feature flags/kill switches (builds, AI, publishing, checkout), credential rotation, session revocation |
| Communicate | Status page; affected organizations notified within 72 h of confirmed personal-data breach; guardians informed when minors are affected |
| Recover | Restore from PITR/backups as needed; verify integrity |
| Learn | Blameless post-mortem within 5 business days; actions tracked to closure |

## 12. Audit logging

Audited actions include: authentication events (login, MFA, failures, lockouts), session revocations, role and policy changes, SSO/SCIM configuration, impersonation start/end, grade changes and releases, payment state changes, refunds, price and plan changes, product/stock changes, moderation actions, AI provider enablement, data export/deletion requests, admin reads of personal data. Records are append-only (database grants), partitioned monthly, and exportable by Institution org admins for their own workspace.
