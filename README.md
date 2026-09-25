# SASCO Palm Expiry Monitoring — GitHub + Firebase

1. Create a GitHub repository and upload all files.
2. In Firebase Console -> Authentication -> Sign-in method, enable Anonymous.
3. In Realtime Database -> Rules, use `database.rules.json` rules for the `expiryMonitoring` path.
4. For automatic deployment, connect the repository to Firebase Hosting / GitHub Actions and create the Firebase service-account secret named:
   `FIREBASE_SERVICE_ACCOUNT_EXPIRY_MONITORING_V2`
5. Push to the `main` branch.

The form writes to:
`expiryMonitoring/drafts/...`
and
`expiryMonitoring/submissions/...`

The Firebase web configuration is included in `public/app.js`. Firebase web API keys are not database passwords; database access is controlled by Authentication and Security Rules.
