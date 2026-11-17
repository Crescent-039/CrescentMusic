import fs from 'node:fs/promises';
import path from 'node:path';
export async function copyPublicDocs(root,out){
  const readme=(await fs.readFile(path.join(root,'README.md'),'utf8')).replace('(LICENSE)','(LICENSE-CrescentMusic.txt)').replace('(tests/fixtures/README.md)','(docs/test-fixtures.md)');
  await fs.writeFile(path.join(out,'README.md'),readme);
  for(const file of ['CONTRIBUTING.md','SECURITY.md','CHANGELOG.md'])await fs.copyFile(path.join(root,file),path.join(out,file));
  await fs.cp(path.join(root,'docs'),path.join(out,'docs'),{recursive:true});
  await fs.copyFile(path.join(root,'tests/fixtures/README.md'),path.join(out,'docs/test-fixtures.md'));
}
