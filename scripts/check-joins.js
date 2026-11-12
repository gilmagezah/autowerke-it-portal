// Flags database joins that Supabase would reject as ambiguous.
// A join from table A to table B is ambiguous when A has more than one foreign key to B,
// unless the join names which one to use (e.g. admin_users!admin_id).
//   npm run check-joins
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// Foreign keys per table, from every schema file
const links = {}; // table -> { target: [columns] }
for (const f of fs.readdirSync(root).filter((x) => /^schema.*\.sql$/.test(x))) {
  const sql = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    for (const col of m[2].matchAll(/^\s*(\w+)\s+uuid[^,\n]*references (\w+)\(/gm)) {
      ((links[m[1]] = links[m[1]] || {})[col[2]] = (links[m[1]][col[2]] || [])).push(col[1]);
    }
  }
}

// Every join in the database code: from('<table>').select('... target(...) ...')
const code = fs.readFileSync(path.join(root, 'lib', 'db.js'), 'utf8');
let problems = 0;
let checked = 0;
for (const m of code.matchAll(/from\('(\w+)'\)\.select\('([^']*)'\)/g)) {
  const [, table, select] = m;
  for (const j of select.matchAll(/(?:\w+:)?(\w+)(!\w+)?\(/g)) {
    const [, target, hint] = j;
    const fks = (links[table] || {})[target];
    if (!fks) continue;
    checked += 1;
    if (fks.length > 1 && !hint) {
      problems += 1;
      console.log(`AMBIGUOUS: ${table} -> ${target} has ${fks.length} links (${fks.join(', ')}); name one, e.g. ${target}!${fks[0]}`);
    }
  }
}
console.log(problems ? `${problems} ambiguous join(s) found.` : `All ${checked} joins are unambiguous.`);
process.exit(problems ? 1 : 0);
