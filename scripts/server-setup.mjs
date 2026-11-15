import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { configFromEnv } from '../server/config.js';
import { Store } from '../server/store.js';
import { Vault } from '../server/vault.js';
import { importData } from '../server/import.js';

const args=process.argv.slice(2),command=args[0];
const flag=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const dataDir=path.resolve(flag('--data-dir')||process.env.QUAGOEV_DATA_DIR||'data-v2');
const envPath=path.join(dataDir,'server.env');
fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
if(command==='init') {
  if(fs.existsSync(envPath)) {console.log(`Existing configuration preserved: ${envPath}`);process.exit(0);}
  const config={QUAGOEV_DATA_DIR:dataDir,QUAGOEV_BIND_HOST:'127.0.0.1',PORT:'3001',QUAGOEV_ACCESS_TOKEN:crypto.randomBytes(32).toString('base64url'),QUAGOEV_VAULT_KEY:crypto.randomBytes(32).toString('hex'),QUAGOEV_TELEMETRY_TOKEN:crypto.randomBytes(32).toString('base64url'),QUAGOEV_COLLECTOR_MODE:'paused',QUAGOEV_BILLING_VERIFIED:'false',QUAGOEV_TELEMETRY_SOURCE_BUDGET_VERIFIED:'false',QUAGOEV_MONTHLY_LIMIT_USD:'8',QUAGOEV_POLL_SECONDS:'600',QUAGOEV_VIN:'',TESLA_CLIENT_ID:'',TESLA_CLIENT_SECRET:'',TESLA_REDIRECT_URI:'',TESLA_FLEET_API:'https://fleet-api.prd.na.vn.cloud.tesla.com'};
  const quote=value=>"'"+String(value).replaceAll("'",'')+"'";
  fs.writeFileSync(envPath,Object.entries(config).map(([k,v])=>`${k}=${quote(v)}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  console.log(`Created private configuration: ${envPath}\nCollection remains paused. Read QUAGOEV_ACCESS_TOKEN from that file when pairing your apps.`);
} else if(['import','import-tesla-session','backup'].includes(command)) {
  const env=dotenv.parse(fs.readFileSync(envPath));const config=configFromEnv({...env,QUAGOEV_DATA_DIR:dataDir});
  if(command==='import-tesla-session') {
    const source=flag('--file');if(!source)throw new Error('Supply --file with the old .sessions.json path');
    const sessions=JSON.parse(fs.readFileSync(source,'utf8'));
    if(!Array.isArray(sessions))throw new Error('Invalid old session file');
    const entries=sessions.filter(item=>Array.isArray(item)&&item[1]?.refresh_token);
    if(entries.length!==1)throw new Error('Session migration requires exactly one account; reconnect Tesla if there are multiple accounts.');
    const session=entries[0][1];new Vault(dataDir,config.vaultKey).write({access_token:session.access_token,refresh_token:session.refresh_token,expires_at:session.expires_at});
    console.log('Tesla session encrypted and imported. Original file untouched; no network requests made.');
  } else {
    const store=new Store(dataDir,config);
    try {
      if(command==='import') {
        const source=flag('--file');if(!source)throw new Error('Supply --file with a legacy history or v2 backup JSON path');
        const input=JSON.parse(fs.readFileSync(source,'utf8'));
        importData(store,input.schemaVersion===2?'snapshot':'legacy',input);
        console.log('History imported. Original file untouched; collector remains configured separately.');
      } else {
        const destination=flag('--file');if(!destination)throw new Error('Supply --file for the new backup');
        fs.writeFileSync(destination,JSON.stringify(store.backup(),null,2)+'\n',{mode:0o600,flag:'wx'});
        console.log(`Saved data backup: ${path.resolve(destination)}`);
      }
    }finally{store.close();}
  }
} else {
  console.log('Usage: node scripts/server-setup.mjs <init|import|import-tesla-session|backup> --data-dir PATH [--file PATH]');
  process.exitCode=1;
}
