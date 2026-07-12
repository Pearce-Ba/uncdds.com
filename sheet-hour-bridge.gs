/* DDS hour-log bridge — lets the dashboard's "Log your hours" tool write
   straight into the chapter points sheet.

   ONE-TIME SETUP (whoever owns the points sheet, ~3 minutes):
   1. Open the points sheet → Extensions → Apps Script.
   2. Delete whatever is in the editor and paste THIS ENTIRE FILE.
   3. If the members tab isn't the gid below, fix TAB_GID (it's the number
      after "gid=" in the sheet URL while that tab is open).
   4. Deploy → New deployment → type "Web app" →
        Execute as: Me · Who has access: Anyone → Deploy.
      Authorize when asked, then copy the .../exec URL.
   5. Paste that URL into dds-cloud-config.js → hourLogEndpoint, push. Done.

   WHAT IT DOES per logged entry:
   - Finds the member's row (email column first, then First + Last name).
   - Finds the category column named in `sheetCategory`. When the member typed
     a custom service type that isn't a sheet column, the site already sent
     "Other Volunteering" (or "Other Dental" for dental) — the hours land
     there, and the SPECIFIC type is stamped onto the cell as a dated note,
     so the exec board can always see what the hours actually were.
   - Socials go to the first column whose header contains "social" (a count,
     one per social). No such column → the entry is skipped (site-only).
   - Adds the hours onto whatever is already in the cell.

   Site edits/deletes do NOT reach the sheet — only new entries. The sheet
   stays the official record the exec board can correct by hand. */

var TAB_GID = 1629504388; // the members tab (from ...#gid=1629504388)

function doPost(e) {
  var out = { ok: false };
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = null;
    ss.getSheets().forEach(function (s) { if (s.getSheetId() === TAB_GID) sheet = s; });
    if (!sheet) sheet = ss.getSheets()[0];

    var values = sheet.getDataRange().getValues();
    var headers = values[0].map(function (h) { return String(h || '').trim(); });
    var lc = function (s) { return String(s == null ? '' : s).toLowerCase().trim(); };
    // headers compare with any trailing "(...)" blurb stripped, same as the site
    var bare = function (s) { return lc(String(s).replace(/\s*\(.*\)\s*$/, '')); };
    var findCol = function (re) {
      for (var i = 0; i < headers.length; i++) if (re.test(headers[i])) return i;
      return -1;
    };

    // ---- member row: email first, then First + Last ----
    var emailCol = findCol(/^email/i), firstCol = findCol(/^first name/i), lastCol = findCol(/^last name/i);
    var row = -1, r;
    if (emailCol > -1 && data.email) {
      for (r = 1; r < values.length; r++) if (lc(values[r][emailCol]) === lc(data.email)) { row = r; break; }
    }
    if (row === -1 && firstCol > -1 && lastCol > -1 && data.name) {
      var parts = lc(data.name).replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(String);
      var first = parts[0] || '', last = parts[parts.length - 1] || '';
      for (r = 1; r < values.length; r++) {
        if (lc(values[r][lastCol]) === last && lc(values[r][firstCol]).indexOf(first) > -1) { row = r; break; }
      }
    }
    if (row === -1) { out.error = 'member row not found'; return respond(out); }

    // ---- target column: sheetCategory exact → contains → kind fallbacks ----
    var want = bare(data.sheetCategory || '');
    var col = -1, i;
    for (i = 0; i < headers.length; i++) if (bare(headers[i]) === want) { col = i; break; }
    if (col === -1) for (i = 0; i < headers.length; i++) if (want && bare(headers[i]).indexOf(want) > -1) { col = i; break; }
    if (col === -1 && data.kind === 'social') for (i = 0; i < headers.length; i++) if (/social/i.test(headers[i]) && !/media/i.test(headers[i])) { col = i; break; }
    if (col === -1 && data.kind !== 'social') {
      var fb = data.kind === 'dental' ? /^other dental/i : /^other volunteering/i;
      col = findCol(fb);
    }
    if (col === -1) { out.error = 'no matching column for ' + data.sheetCategory; return respond(out); }

    // ---- add the hours (socials: the count) + stamp the specifics as a note ----
    var cell = sheet.getRange(row + 1, col + 1);
    var cur = Number(cell.getValue()) || 0;
    var hours = Number(data.hours) || 0;
    if (!(hours > 0)) { out.error = 'no hours'; return respond(out); }
    cell.setValue(cur + hours);

    var stamp = (data.date || new Date().toISOString().slice(0, 10)) + ': +' + hours +
      (data.kind === 'social' ? ' social' + (hours === 1 ? '' : 's') : 'h') +
      (bare(data.category) !== bare(headers[col]) && data.category ? ' — ' + data.category : '') +
      (data.note ? ' (' + data.note + ')' : '') + ' · via site';
    var prev = cell.getNote();
    cell.setNote(prev ? prev + '\n' + stamp : stamp);

    out.ok = true; out.column = headers[col];
  } catch (err) {
    out.error = String(err);
  }
  return respond(out);
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
