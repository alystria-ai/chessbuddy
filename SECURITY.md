# Security

Please do not post vulnerabilities, keys, tokens, or private conversations in a public issue. Send a private report through GitHub's security advisory feature for this repository, if available. Describe the affected route or version, the impact, and a minimal reproduction with secrets removed.

`CONVAI_API_KEY` and session secrets belong only in server-side environment variables. The browser receives short-lived credentials. If you think a real credential was exposed, rotate it with its provider before sharing a redacted report.
