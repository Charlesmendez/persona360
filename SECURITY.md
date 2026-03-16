# Security Policy

## Reporting a vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Instead:

- email the maintainer directly
- include reproduction steps
- include impact and affected files if known

If you are unsure whether something is a security issue, report it anyway.

## Scope

This project handles:

- local SQLite data
- optional Postgres connections
- imported notes, emails, and transcripts
- agent-driven structured writes

Please report issues involving:

- unsafe command execution
- prompt-injection driven writes
- data leakage
- viewer XSS or unsafe rendering
- credential or connection-string exposure
