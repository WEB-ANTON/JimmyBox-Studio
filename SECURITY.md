# Security Policy

## Supported Versions

Security fixes are handled for the latest public JimmyBox Studio release.

## Reporting a Vulnerability

Please do not publish security-sensitive details in a public issue.

Send a private report to the project maintainer with:

- affected version
- impact
- reproduction steps
- any logs, payloads, or project setup details needed to verify the issue

You should receive an acknowledgement within a reasonable time window. Public
details will be shared after a fix or mitigation is available.

## Scope

Relevant reports include:

- arbitrary file write/read outside managed project paths
- unsafe archive extraction
- unsafe database import behavior
- credential leakage
- unintended mutation outside the JimmyBox `/etc/hosts` block

Local development projects may contain third-party CMS code and dependencies.
Vulnerabilities in those projects should be reported to their upstream maintainers.
