# PHX-LAUNCH-002-R6 — Identity-to-Workspace Resolution

`GET /api/me/workspaces` resolves the already-authenticated Phoenix user and
returns only non-deleted workspaces reached through non-deleted `Active`
memberships. `Invited` and `Suspended` memberships are excluded.

The actor source is resolved once. The route accepts no user id, workspace id,
email, role, or membership claim from the client. Production-auth Platform data
loaders use the first stable active membership returned by this endpoint instead
of `NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID`. Multi-workspace selection UI is
deferred; no workspace is guessed when the list is empty.
