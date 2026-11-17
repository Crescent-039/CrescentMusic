import fs from 'node:fs/promises';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export async function writeThirdPartyNotices(root,destination){
  const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
  const sections=['Crescent Music — third-party software notices\n\nElectron/Chromium notices are also distributed as LICENSE and LICENSES.chromium.html next to the executable.\nOptional native packages are listed for the installed platform.\n'];
  for(const [location,info] of Object.entries(lock.packages)){
    if(!location.startsWith('node_modules/')||info.dev&&location!=='node_modules/electron')continue;
    const folder=path.join(root,location);if(info.optional&&!existsSync(folder))continue;
    const pkg=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));
    const files=(await fs.readdir(folder)).filter(name=>/^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
    const notices=[];for(const file of files)if((await fs.stat(path.join(folder,file))).isFile())notices.push(`${file}\n${await fs.readFile(path.join(folder,file),'utf8')}`);
    // Native Koffi platform packages use the parent package's license text.
    if(!notices.length&&pkg.name.startsWith('@koromix/koffi-'))notices.push(await fs.readFile(path.join(root,'node_modules/koffi/LICENSE.txt'),'utf8'));
    if(!notices.length&&existsSync(path.join(folder,'README.md'))){
      const readme=await fs.readFile(path.join(folder,'README.md'),'utf8');
      const license=readme.match(/^## Licen[cs]e\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
      if(license)notices.push(`License section from README.md\n${license[1]}`);
    }
    if(!notices.length)throw new Error(`缺少第三方许可证原文：${pkg.name}`);
    sections.push(`\n${'='.repeat(72)}\n${pkg.name}@${pkg.version}\nSPDX: ${pkg.license}\n${pkg.homepage||pkg.repository?.url||''}\n\n${notices.join('\n\n')}`);
  }
  await fs.writeFile(destination,sections.join('\n'));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=path.resolve(import.meta.dirname,'..');await writeThirdPartyNotices(root,path.join(root,'THIRD-PARTY-NOTICES.txt'));
}
