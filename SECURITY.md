# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

Always upgrade to the latest 1.x release for security fixes.

## Reporting a Vulnerability

**Do not** disclose vulnerabilities publicly (Issues, PRs, Discussions).

**Report privately** via GitHub's **Security Advisory** → "Report a vulnerability" in this repo.

Include:
- Description and impact
- Steps to reproduce
- Affected versions
- Optional: fix suggestion

**Response:**
- Acknowledgment within 48 hours
- We'll work with you to validate and fix
- You'll be credited (if you agree) after the fix is released

If declined, we'll explain why.

## Security-critical Configuration

For production deployments, set these environment variables **securely**:

| Var | Requirement |
| --- | ----------- |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Strong random values, never defaults |
| `CORS_ALLOWED_ORIGINS` | Exact frontend domain(s), never wildcard |
| `DATABASE_URL` / `REDIS_URL` | Strong passwords, internal network only |
| `MAPILLARY_TOKEN` | Server-side only, never commit to repo |

> `.env` is ignored by git, but double-check before pushing.

Security fixes are announced in [Releases](https://github.com/cn171g11/mma-guessr/releases) with notes.
