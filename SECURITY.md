# Security Policy

This document describes the security model of `@majikah/sdk`, what the SDK does and does not guarantee, how credentials and cryptographic operations are handled, and how to report security vulnerabilities.

The SDK is a client library for the Majikah ecosystem. It provides typed access to Majikah public services such as MUID, TSA, SLink, and Notary, while relying on separate Majikah cryptographic libraries for local signing, sealing, and verification.

If something in this document appears inconsistent with the implementation, please [report it](#reporting-a-vulnerability).

---

## Table of Contents

- [Security Policy](#security-policy)
  - [Table of Contents](#table-of-contents)
  - [Reporting a Vulnerability](#reporting-a-vulnerability)
  - [Security Model](#security-model)
    - [What the SDK actually does](#what-the-sdk-actually-does)
    - [Trust boundaries](#trust-boundaries)
      - [Application boundary](#application-boundary)
      - [SDK boundary](#sdk-boundary)
      - [Hosted-service boundary](#hosted-service-boundary)
  - [API Authentication](#api-authentication)
    - [API keys are credentials](#api-keys-are-credentials)
    - [API keys are not signing keys](#api-keys-are-not-signing-keys)
  - [Local Cryptography](#local-cryptography)
  - [Verification and Trust](#verification-and-trust)
  - [Notary Security Model](#notary-security-model)
    - [Preserve the sealed artifact](#preserve-the-sealed-artifact)
    - [Payment does not prove document trust](#payment-does-not-prove-document-trust)
    - [Chain anchors](#chain-anchors)
  - [Retry and Request Safety](#retry-and-request-safety)
  - [Scope](#scope)
    - [In scope](#in-scope)
    - [Out of scope](#out-of-scope)
  - [Known Limitations \& Non-Goals](#known-limitations--non-goals)
    - [No replacement for application authorization](#no-replacement-for-application-authorization)
    - [No secret management](#no-secret-management)
    - [No automatic trust policy](#no-automatic-trust-policy)
    - [No confidentiality guarantee from signing](#no-confidentiality-guarantee-from-signing)
    - [No absolute freshness guarantee](#no-absolute-freshness-guarantee)
    - [Network security remains important](#network-security-remains-important)
    - [Pre-1.0 API stability](#pre-10-api-stability)
  - [Dependency \& Supply Chain](#dependency--supply-chain)
  - [Secure Usage Guidelines](#secure-usage-guidelines)
    - [Credentials](#credentials)
    - [Private keys](#private-keys)
    - [Verification](#verification)
    - [Notarization](#notarization)
    - [Transport and runtime](#transport-and-runtime)
    - [Logging and observability](#logging-and-observability)
  - [Cryptographic Responsibility](#cryptographic-responsibility)
  - [Disclosure Policy](#disclosure-policy)
  - [Contact](#contact)

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately through one of the following channels:

1. **GitHub Private Vulnerability Reporting** — use the Security tab of the `Majikah/sdk` repository.

2. **Email** — [business@majikah.solutions](mailto:business@majikah.solutions) with `SECURITY` in the subject line.

Please include:

* A clear description of the vulnerability
* The affected SDK version(s)
* The affected service or module
* The potential security impact
* Reproduction steps or a minimal proof of concept
* Whether the issue requires a malicious API response, malicious input, a compromised API key, or local application access
* Whether the issue occurs entirely within the SDK or depends on a Majikah hosted service
* Any relevant logs, stack traces, request examples, or test cases

Please do not include API keys, private signing keys, passwords, authentication tokens, or other secrets in a vulnerability report.

**This is an independently maintained project — response times are best-effort and are not a contractual SLA.**

We aim, where practical, to:

| Stage                                  | Target                               |
| -------------------------------------- | ------------------------------------ |
| Initial acknowledgment                 | Within 5 business days               |
| Preliminary assessment                 | Within 10 business days              |
| Fix or mitigation for confirmed issues | Best-effort, prioritized by severity |

---

## Security Model

### What the SDK actually does

`@majikah/sdk` is a **service integration and orchestration library**.

It provides:

* Typed API clients
* Authentication headers and request handling
* Input validation
* Service-specific request and response handling
* Retry and timeout behavior
* Higher-level workflows for TSA, SLink, MUID, and Notary
* Local integration with Majikah cryptographic libraries

The SDK itself does **not** replace the security model of the hosted Majikah services, the runtime in which the application executes, or the application's own authorization and key-management policies.

The SDK should therefore be understood as one layer in a larger security boundary:

```text
Application
     │
     ├── Application authorization
     ├── Secret storage
     ├── User/session security
     ├── MajikKey / private-key custody
     │
     ▼
@majikah/sdk
     │
     ├── Validation
     ├── Authentication
     ├── Request construction
     ├── Transport handling
     ├── Response validation
     └── Service orchestration
     │
     ▼
Majikah public services
     │
     ├── MUID
     ├── TSA
     ├── SLink
     └── Notary
```

### Trust boundaries

The SDK crosses several distinct trust boundaries.

#### Application boundary

Your application controls:

* API key storage
* User authorization
* Access control
* Private-key custody
* Selection of trusted identities
* Decisions about whether a verification result is sufficient for a business action

The SDK does not automatically make these decisions for you.

#### SDK boundary

The SDK is responsible for:

* Validating supported inputs
* Constructing authenticated requests
* Applying configured timeouts and retries
* Mapping API responses into typed results and errors
* Orchestrating multi-step workflows

The SDK should not silently weaken an application's security policy in order to make a request succeed.

#### Hosted-service boundary

Majikah services are responsible for:

* API authentication and authorization
* Rate limiting
* Payment processing and payment state
* Server-side validation
* Storage and service-side integrity
* Blockchain interaction
* Server-side abuse prevention and infrastructure security

A vulnerability in hosted infrastructure may not be a vulnerability in the SDK itself, but should still be reported privately so it can be coordinated with the appropriate system owners.

---

## API Authentication

Majikah API access uses an API key supplied when creating `MajikahSDKClient`.

For example:

```ts
const majikah = new MajikahSDKClient({
  apiKey: process.env.MAJIKAH_API_KEY!,
});
```

The SDK attaches the configured API key to authenticated requests using the expected authentication mechanism.

### API keys are credentials

An API key should be treated as a secret credential unless the specific service explicitly documents otherwise.

Do not:

* Commit API keys to source control
* Hard-code production API keys into public repositories
* Include API keys in client-side bundles when they grant privileged access
* Place API keys in URLs
* Log API keys
* Send API keys to third-party telemetry systems

Prefer:

* Environment variables
* Secret-management systems
* Server-side execution
* Runtime-specific secure secret stores

If an API key is compromised, revoke or rotate it through the appropriate Majikah developer controls as soon as possible.

### API keys are not signing keys

A Majikah API key and a `MajikKey` private signing key serve different purposes.

The API key authenticates requests to Majikah services.

A `MajikKey` contains cryptographic signing material used by local cryptographic operations.

The SDK does not need to upload a `MajikKey` private key to the Majikah API merely to perform local signing or sealing operations.

---

## Local Cryptography

Cryptographic operations involving private keys are delegated to Majikah cryptographic libraries such as:

* `@majikah/majik-key`
* `@majikah/majik-signature`
* `@majikah/majik-slink`

The SDK orchestrates these operations but does not replace their cryptographic implementations.

For example:

```text
Application
    │
    ├── MajikKey
    │      └── private-key operation remains local
    │
    └── @majikah/sdk
           │
           └── Majikah API
```

This separation means that network access is not inherently required for local signing, sealing, or verification operations provided by the underlying libraries.

Security issues affecting the cryptographic primitives themselves should also be reported to the corresponding upstream project when appropriate.

---

## Verification and Trust

A successful API response does not automatically constitute cryptographic proof.

Applications should distinguish between:

1. **Service lookup**
2. **Cryptographic verification**
3. **Application-level trust**

For example, an SLink lookup may establish that a claim exists in the registry. That does not by itself establish that the claim's signature is valid.

Where cryptographic verification is available, applications should verify the returned cryptographic proof and independently determine whether the signer or identity is trusted for the intended operation.

Likewise, MUID identity resolution and signature verification are separate concepts:

```text
MUID lookup
    │
    └── identifies a public identity

Signature verification
    │
    └── determines whether the signature is cryptographically valid

Application trust policy
    │
    └── determines whether that signer is authorized
```

A valid signature from an unexpected or unauthorized identity should not be treated as an authorized action.

---

## Notary Security Model

Majikah Notary uses a hash-based notarization workflow.

The SDK operates on a sealed artifact and obtains its `sealHash`. Payment and notarization requests use the hash rather than uploading the entire sealed file to the notarization service.

The high-level flow is:

```text
Signed file
    │
    ▼
Seal locally
    │
    ├── sealedBlob
    └── sealHash
          │
          ▼
     Create / resume payment
          │
          ▼
     Complete payment
          │
          ▼
      Register sealHash
          │
          ▼
     Confirm chain anchor
          │
          ▼
 Embed chain anchor locally
```

### Preserve the sealed artifact

When `initiateNotarization()` returns:

```ts
{
  status: "payment_required",
  sealHash,
  sealedBlob,
  checkout,
}
```

the `sealedBlob` and `sealHash` are logically paired.

Applications should preserve the returned sealed artifact exactly as produced until finalization.

Do not:

* Re-seal the document
* Replace the file contents
* Modify the signature envelope
* Reconstruct a different sealed document
* Assume that two separately generated sealed files are interchangeable

The `sealHash` must continue to correspond to the sealed artifact being finalized.

The same principle applies to:

```ts
{
  status: "ready_to_finalize",
  sealHash,
  sealedBlob,
}
```

### Payment does not prove document trust

A completed payment establishes payment state for the notarization workflow. It does not, by itself, prove:

* Who signed the file
* Whether the underlying signatures are valid
* Whether the application should trust the signer
* Whether the document is semantically correct

Applications should independently perform the appropriate signature and identity verification before treating a notarized file as trusted.

### Chain anchors

A returned chain anchor establishes an on-chain commitment associated with the notarized seal hash.

Applications should still verify the anchor and associated seal/signature state according to their own trust policy before making high-value decisions.

---

## Retry and Request Safety

The SDK uses retry behavior intended to distinguish retry-safe requests from operations with potentially irreversible side effects.

`GET` requests may be retried automatically.

`POST` requests are only retried where the SDK can safely treat the operation as idempotent.

This distinction is security-relevant because blindly retrying a request that creates a payment, registration, or other side effect could create duplicate operations.

Applications should not assume that all network errors imply the server did not process a request.

For security-sensitive or payment-related workflows:

* Treat timeouts and connection failures as ambiguous outcomes
* Query the relevant resource state before repeating a side-effecting operation
* Use the SDK's returned identifiers and workflow state when resuming
* Avoid implementing additional blind retries around SDK methods that already manage retries

---

## Scope

### In scope

Security issues in the SDK itself include:

* API key leakage caused by SDK behavior
* Authentication headers being sent to unintended origins
* Credential disclosure through URLs, logs, or error objects
* Incorrect validation that allows invalid security-sensitive input to pass
* Incorrect request construction that bypasses intended authentication or authorization boundaries
* Response parsing vulnerabilities
* Unexpected execution of attacker-controlled content
* Prototype pollution or related object-manipulation vulnerabilities
* SSRF or unintended request forwarding caused by attacker-controlled configuration or input
* Incorrect retry behavior that can cause unintended duplicate side effects
* Incorrect handling of payment or notarization state
* Confusion between `sealedBlob` and `sealHash` that could associate the wrong artifact with a notarization workflow
* Incorrect verification or trust decisions caused by SDK logic
* Sensitive data exposure through SDK-generated errors or logs
* Dependency vulnerabilities that materially affect the SDK's security boundary

### Out of scope

The following are generally outside the SDK's direct security boundary:

* Compromise of a user's machine or browser
* Malware or other code already executing inside the host application
* Improper application authorization decisions
* Insecure storage of API keys by the application
* Insecure storage of `MajikKey` private material by the application
* Vulnerabilities in unrelated upstream cryptographic libraries, although they should also be reported to the relevant maintainers
* Misuse of valid SDK results by an application
* Inadequate business-level identity or authorization policy
* Denial of service caused solely by intentionally oversized application inputs where the application itself controls the input boundary
* Availability incidents confined to Majikah hosted infrastructure, unless the SDK introduces or amplifies the issue

Hosted-service vulnerabilities should still be reported privately so they can be routed to the appropriate system owners.

---

## Known Limitations & Non-Goals

Documented limitations are part of the security model.

### No replacement for application authorization

The SDK authenticates API requests but does not determine whether a particular end user is authorized to perform an application action.

Your application must enforce its own:

* User authorization
* Organization membership
* Resource permissions
* Role-based access control
* Approval requirements

### No secret management

The SDK accepts credentials supplied by the application but does not provide a secure vault for long-term secret storage.

Applications are responsible for securely storing:

* API keys
* Session credentials
* `MajikKey` material
* Payment-related secrets
* Any application-specific tokens

### No automatic trust policy

A valid signature, valid MUID, valid SLink, or valid notarization result is not automatically equivalent to application authorization.

The application must decide which identities, issuers, domains, organizations, or trust anchors are acceptable.

### No confidentiality guarantee from signing

Digital signatures and notarization provide integrity/authenticity properties. They do not inherently provide confidentiality.

Do not assume that a signed or notarized document is secret.

Use an appropriate encryption mechanism when confidentiality is required.

### No absolute freshness guarantee

A valid signature or notarization does not necessarily mean that the associated content is recent.

Where freshness matters, applications should evaluate timestamps, expiration fields, notarization state, and their own freshness policy.

### Network security remains important

The SDK relies on the application's runtime and network environment for transport security.

Applications should use HTTPS endpoints and should not disable TLS certificate validation.

Custom `fetch` implementations should preserve normal secure transport behavior.

### Pre-1.0 API stability

The SDK is pre-1.0. Security-sensitive behavior, defaults, and API contracts may change between releases.

Review release notes before upgrading and test security-sensitive workflows after dependency updates.

---

## Dependency & Supply Chain

The SDK depends on both general-purpose runtime libraries and Majikah cryptographic packages.

The exact dependency set may evolve between releases.

Security-sensitive functionality should therefore be evaluated across the entire dependency chain:

```text
Your application
      │
      ▼
 @majikah/sdk
      │
      ├── Majikah cryptographic packages
      ├── HTTP / transport dependencies
      └── other runtime dependencies
```

The SDK does not implement all cryptographic primitives itself. Where cryptographic operations are delegated to separate Majikah libraries, vulnerabilities in those dependencies may affect the resulting security properties.

Applications should:

* Keep the SDK and its dependencies reasonably up to date
* Review lockfile changes
* Monitor security advisories
* Run `npm audit` or the equivalent package-manager audit tooling
* Avoid installing unnecessary unrelated dependencies into security-sensitive deployments
* Review dependency updates before deploying them to production

A compromised dependency may be able to execute with the privileges of the host application, so supply-chain security is part of the overall application threat model.

---

## Secure Usage Guidelines

### Credentials

* ✅ Keep production API keys in secure server-side or runtime secret stores.
* ✅ Rotate compromised credentials promptly.
* ✅ Use separate credentials for development and production where practical.
* ❌ Do not commit API keys to Git.
* ❌ Do not embed privileged API keys in public client bundles.
* ❌ Do not log authentication headers.

### Private keys

* ✅ Treat `MajikKey` instances and private material as highly sensitive.
* ✅ Keep private-key operations local where possible.
* ✅ Lock or otherwise dispose of unlocked key material according to the key-management library's guidance.
* ❌ Never send private signing keys to the Majikah API as a substitute for local signing.
* ❌ Never log private key material, mnemonics, or derived secrets.

### Verification

* ✅ Check the actual cryptographic verification result.
* ✅ Verify that the signer identity is the identity your application intended to trust.
* ✅ Treat identity lookup and cryptographic verification as separate steps.
* ✅ Apply application-level authorization after cryptographic verification.
* ❌ Do not treat the presence of a signature, MUID, SLink, or notarization record as proof of authorization.
* ❌ Do not trust user-controlled signer identifiers without verification.

### Notarization

* ✅ Preserve the `sealedBlob` and `sealHash` returned by the initiation workflow as a pair.
* ✅ Use the returned `sealedBlob` when finalizing payment-required or ready-to-finalize flows.
* ✅ Verify the underlying signature(s) before relying on notarization as evidence of authorship or authorization.
* ✅ Treat payment completion and cryptographic verification as separate security events.
* ❌ Do not modify or re-seal the artifact between initiation and finalization.
* ❌ Do not assume payment alone proves document authenticity.

### Transport and runtime

* ✅ Use HTTPS endpoints.
* ✅ Keep TLS verification enabled.
* ✅ Restrict custom `fetch` implementations to trusted code.
* ✅ Treat API responses as untrusted input until validated.
* ❌ Do not place credentials into URLs.
* ❌ Do not disable certificate validation to work around transport errors.
* ❌ Do not blindly retry payment or other side-effecting operations outside the SDK.

### Logging and observability

Applications should take care not to expose:

* API keys
* Authorization headers
* Private signing material
* Mnemonics
* Session tokens
* Sensitive document content
* Payment secrets

Prefer structured logs that record identifiers and high-level states rather than raw authenticated requests or sensitive payloads.

---

## Cryptographic Responsibility

`@majikah/sdk` is not the primary cryptographic implementation layer.

Depending on the workflow, the SDK integrates with Majikah libraries responsible for operations such as:

* Key generation and management
* Digital signatures
* Signature verification
* File sealing
* SLink signing and verification
* Hash computation

The security of those primitives depends on the corresponding cryptographic libraries and their underlying implementations.

The SDK's security responsibility is instead centered on **correct orchestration**:

```text
Input
  │
  ▼
Validation
  │
  ▼
Correct cryptographic library invocation
  │
  ▼
Correct authenticated request
  │
  ▼
Correct response/state handling
  │
  ▼
Correct application-facing result
```

A vulnerability in this orchestration can still be security-critical even when the underlying cryptographic primitive is sound.

Examples include:

* Sending an API key to the wrong origin
* Associating a payment with the wrong seal hash
* Returning a verification result for the wrong signer
* Incorrectly interpreting an API response
* Retrying a non-idempotent operation
* Losing the relationship between a sealed artifact and its seal hash

---

## Disclosure Policy

We follow a **coordinated disclosure** approach.

1. A vulnerability is reported privately using [Reporting a Vulnerability](#reporting-a-vulnerability).
2. The report is reviewed and its security impact is assessed.
3. A fix or mitigation is developed where appropriate.
4. A patched release is published when practical.
5. Details may be disclosed after remediation, together with reporter credit if requested.

We do not currently operate a paid bug bounty program.

Good-faith researchers should avoid:

* Public disclosure before reasonable coordination
* Destructive testing
* Accessing data unrelated to the reported issue
* Disrupting production services
* Testing credentials or accounts they do not own or have permission to use

If a report involves a live hosted service, please include enough information for the issue to be reproduced without unnecessarily exposing user or production data.

---

## Contact

* **Security reports:** GitHub Private Vulnerability Reporting or [business@majikah.solutions](mailto:business@majikah.solutions) with `SECURITY` in the subject
* **General/non-security issues:** GitHub Issues in the Majikah SDK repository
* **Maintainer:** Josef Elijah Fabian (Zelijah)
* **Organization:** Majikah Solutions OPC
