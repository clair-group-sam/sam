# Teams app « S.A.M. » — package and setup (TMS-01)

The package = `manifest.json` + `color.png` + `outline.png` zipped together (files at the root of the zip, no folder):

```bash
cd teams && zip -j ../sam-teams-app.zip manifest.json color.png outline.png
```

## What IT creates (once)

1. **Azure Bot** resource (Azure portal › Create a resource › Azure Bot): pricing tier **F0**, type **Single Tenant**,
   *Use existing app registration* = the S.A.M. app `f5834b34-2908-4ab2-a5ae-0673d98c7752`.
   Messaging endpoint: `https://sam.clair-group.com/api/teams/messages` (preview: `https://sam-git-dev-sam-03e0.vercel.app/api/teams/messages`).
   Channels › add **Microsoft Teams**.
2. **App registration S.A.M.** (already exists): keep the client secret used by `GRAPH_CLIENT_SECRET`; add the application permission
   **TeamsAppInstallation.ReadWriteForUser.All** (Graph) with admin consent — lets S.A.M. open the bot chat for people who never opened it.
   Expose an API: Application ID URI `api://sam.clair-group.com/f5834b34-2908-4ab2-a5ae-0673d98c7752`, scope `access_as_user`,
   authorised client applications `1fec8e78-bce4-4aaf-ab1b-5451cc387264` (Teams desktop/mobile) and `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` (Teams web) — needed for the step-up sign-in of signatures (COM-03), iteration 2.
3. **Teams admin center** › Teams apps › Manage apps › Upload new app → the zip; allow it for the organisation (or the Clair Group groups).
   Note the **catalog id** of the app (Manage apps › S.A.M. › App ID) → Vercel `TEAMS_APP_ID`.
4. Later (COM-03 signatures): a Conditional Access **authentication context** « S.A.M. signature » requiring MFA.

## Vercel

`TEAMS_APP_ID` (catalog id), `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` (already there), optional `TEAMS_SERVICE_URL`, `SAM_ORIGIN`.

## Test

Settings › Integrations › « Send me a test card ». Then open the bot in Teams and write `tasks`.
