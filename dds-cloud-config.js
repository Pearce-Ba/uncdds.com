/* DDS cloud sync — one-time setup (takes about 3 minutes, done once ever).

   Until this file is filled in, every feature still works, but accounts,
   chat, resources, and the family tree live only in each visitor's own
   browser. Fill it in and push, and the whole chapter shares one database.

   SETUP (president or webmaster):
   1. Go to https://console.firebase.google.com → "Add project"
      (name it anything, e.g. "uncdds-site"; Analytics off is fine).
   2. In the project: Build → Firestore Database → "Create database"
      → Start in production mode → location "nam5 (United States)".
   3. Firestore → Rules tab → replace the rules with:

        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            match /{document=**} {
              allow read, write: if true;
            }
          }
        }

      → Publish. (The site does its own sign-in checks; these rules make
      the database reachable by the site without Google accounts. Anyone
      determined could read or edit chapter data — the same trust level as
      a shared Google Sheet with link access. The repo keeps daily backups.)
   4. Project settings (gear icon) → General → "Your apps" → Web app (</>)
      → register (no hosting needed). Copy `projectId` and `apiKey` from
      the config it shows into the two lines below.
   5. Commit + push this file. Done — every browser now shares one backend.
*/
window.DDS_CLOUD = {
  projectId: '',   // e.g. 'uncdds-site'
  apiKey: '',      // e.g. 'AIzaSyC...'

  /* OPTIONAL — auto-push logged hours into the chapter Google Sheet.
     Leave empty and the "Log your hours" tool still works: entries live in the
     synced site store and count toward each member's gauges, and the sheet is
     one click away as the official record. To also write entries straight into
     the sheet, deploy a Google Apps Script Web App on it (Extensions → Apps
     Script → a doPost(e) that appends JSON.parse(e.postData.contents) as a row
     → Deploy → Web app → "Anyone" access) and paste its /exec URL here. */
  hourLogEndpoint: ''
};
